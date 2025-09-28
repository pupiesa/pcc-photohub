import express from "express";
import fs from "fs";
import path from "path";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { exec } from "child_process";
import { spawn } from "child_process";
import cors from 'cors';
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const raw = process.env.CORS_ALLOW_ORIGINS || "";
const allowlist = raw.split(",").map(s => s.trim()).filter(Boolean);
const allowNoOrigin = true;

const corsOptions = {
  origin(origin, cb) {
    if (!origin) return allowNoOrigin ? cb(null, true) : cb(new Error("CORS: Origin required"), false);
    if (allowlist.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS blocked: ${origin}`), false);
  },
  methods: ["GET","HEAD","POST","PATCH","PUT","DELETE","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization"],
  credentials: false,
};

app.use(express.json());
app.use(cors(corsOptions));

// 🖨 Print Function
function printPDF(filePath) {
  return new Promise((resolve, reject) => {
    const printerName = process.env.PRINTER_NAME;
    if (!printerName) return reject(new Error("PRINTER_NAME not set in .env"));

    const cmd = `lp -d "${printerName}" "${filePath}"`;
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        console.error("Printing error:", stderr || error.message);
        return reject(error);
      }
      console.log("✅ Print job sent");
      resolve(stdout.trim());
    });
  });
}

// 📄 Create & Print PDF
app.post("/print", async (req, res) => {
  const { paths, overlayPath, templateKey, slots, footerText, footerH } = req.body;

  if (!paths || !Array.isArray(paths) || paths.length === 0) {
    return res.status(400).json({ error: "No paths provided" });
  }

  // ---------- defaults (4x6 inch @ 72pt/in) ----------
  const PAGE_W = 288, PAGE_H = 432;
  const MARGIN = 10, GUTTER = 8;
  const FOOTER_H_DEFAULT = 120, SLOT_ASPECT = 3/2, FRAME_PAD = 4, BORDER_W = 0.8;
  const FOOTER_H = Number.isFinite(footerH) ? Math.max(0, footerH) : FOOTER_H_DEFAULT;

  // ---------- helpers ----------
  const resolveIfExists = (p) => {
    try {
      if (typeof p === "string" && p.startsWith("data:image/")) return { kind: "base64", value: p };
      const abs = path.isAbsolute(p) ? path.normalize(p) : null;
      if (abs && fs.existsSync(abs)) return { kind: "fs", value: abs };
      const rel = path.normalize(path.isAbsolute(p) ? p : path.join(process.cwd(), p));
      if (fs.existsSync(rel)) return { kind: "fs", value: rel };
      return null;
    } catch { return null; }
  };

  const loadImage = async (pdfDoc, entry) => {
    if (entry.kind === "base64") {
      const m = entry.value.match(/^data:(image\/(?:png|jpeg|jpg));base64,(.+)$/i);
      if (!m) throw new Error("Invalid data URL");
      const bytes = Buffer.from(m[2], "base64");
      return /png$/i.test(m[1]) ? pdfDoc.embedPng(bytes) : pdfDoc.embedJpg(bytes);
    } else {
      const bytes = fs.readFileSync(entry.value);
      return entry.value.toLowerCase().endsWith(".png") ? pdfDoc.embedPng(bytes) : pdfDoc.embedJpg(bytes);
    }
  };

  // ---------- resolve input images ----------
  const resolved = [], missing = [];
  for (const p of paths) {
    const r = resolveIfExists(p);
    if (r) resolved.push(r); else missing.push(p);
  }
  if (resolved.length === 0) {
    return res.status(400).json({ error: "No valid image files found on server", missing, cwd: process.cwd() });
  }

  // pick 4
  let plan;
  if (resolved.length === 1) plan = [resolved[0], resolved[0], resolved[0], resolved[0]];
  else if (resolved.length === 2) plan = [resolved[0], resolved[1], resolved[1], resolved[0]];
  else plan = resolved.slice(0, 4);

  // ---------- FIX: use __dirname for templates root ----------
  const templatesRoot = path.join(__dirname, "templates");
  const baseDir = templateKey ? path.join(templatesRoot, templateKey) : null;
  const confPath = baseDir ? path.join(baseDir, "template.json") : null;
  const overlayPathAuto = baseDir ? path.join(baseDir, "overlay.png") : null;

  let overlayAbs = null;
  if (overlayPath) {
    const r = resolveIfExists(overlayPath);
    overlayAbs = r?.value || null;
  } else if (overlayPathAuto && fs.existsSync(overlayPathAuto)) {
    overlayAbs = overlayPathAuto;
  }

  // load slots
  let slotsConfig = Array.isArray(slots) ? slots : null;
  if (!slotsConfig && confPath && fs.existsSync(confPath)) {
    try {
      const content = JSON.parse(fs.readFileSync(confPath, "utf8"));
      if (Array.isArray(content.slots) && content.slots.length >= 4) {
        slotsConfig = content.slots.slice(0, 4);
      } else {
        console.warn("template.json found but 'slots' missing/invalid:", confPath);
      }
    } catch (e) {
      console.warn("template.json parse error:", e?.message || e);
    }
  }

  // debug logs
  console.log("[TEMPLATE] root:", templatesRoot);
  console.log("[TEMPLATE] baseDir:", baseDir);
  console.log("[TEMPLATE] confPath exists?:", !!(confPath && fs.existsSync(confPath)));
  console.log("[TEMPLATE] overlayPath used:", overlayAbs || "(none)");
  console.log("[TEMPLATE] slots mode:", slotsConfig ? "template-slots" : "auto-grid");

  try {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([PAGE_W, PAGE_H]);

    // BG
    page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: rgb(1,1,1) });

    // overlay as background
    if (overlayAbs && fs.existsSync(overlayAbs)) {
      const ovBytes = fs.readFileSync(overlayAbs);
      const overlayImg = await pdfDoc.embedPng(ovBytes);
      page.drawImage(overlayImg, { x: 0, y: 0, width: PAGE_W, height: PAGE_H });
    }

    if (slotsConfig && slotsConfig.length >= 4) {
      // place photos on template slots
      for (let i = 0; i < 4; i++) {
        const img = await loadImage(pdfDoc, plan[i]);
        const slot = slotsConfig[i];
        const scale = Math.min(slot.w / img.width, slot.h / img.height);
        const drawW = img.width * scale, drawH = img.height * scale;
        const x = slot.x + (slot.w - drawW) / 2;
        const y = slot.y + (slot.h - drawH) / 2;
        page.drawImage(img, { x, y, width: drawW, height: drawH });
      }
    } else {
      // fallback grid
      const GRID_W = PAGE_W - MARGIN * 2, GRID_H = PAGE_H - MARGIN * 2 - FOOTER_H;
      const cellW = (GRID_W - GUTTER) / 2, cellH = (GRID_H - GUTTER) / 2;
      const slotW = Math.min(cellW, cellH * SLOT_ASPECT);
      const slotH = slotW / SLOT_ASPECT;

      for (let i = 0; i < 4; i++) {
        const img = await loadImage(pdfDoc, plan[i]);
        const row = Math.floor(i / 2), col = i % 2;
        const cellX = MARGIN + col * (cellW + GUTTER);
        const cellY = PAGE_H - MARGIN - FOOTER_H - (row + 1) * cellH - row * GUTTER;
        const slotX = cellX + (cellW - slotW) / 2;
        const slotY = cellY + (cellH - slotH) / 2;

        page.drawRectangle({ x: slotX, y: slotY, width: slotW, height: slotH, color: rgb(1,1,1),
          borderColor: rgb(0.8,0.8,0.8), borderWidth: BORDER_W });

        const innerW = slotW - FRAME_PAD*2, innerH = slotH - FRAME_PAD*2;
        const scale = Math.min(innerW / img.width, innerH / img.height);
        const drawW = img.width * scale, drawH = img.height * scale;
        const imgX = slotX + FRAME_PAD + (innerW - drawW)/2;
        const imgY = slotY + FRAME_PAD + (innerH - drawH)/2;
        page.drawImage(img, { x: imgX, y: imgY, width: drawW, height: drawH });
      }

      page.drawRectangle({ x: MARGIN, y: MARGIN + FOOTER_H - 18,
        width: PAGE_W - MARGIN*2, height: 0.6, color: rgb(0.9,0.9,0.9) });

      const label = typeof footerText === "string" ? footerText : "Pcc Photo Booth";
      if (label) {
        const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
        const fs = 12, tw = font.widthOfTextAtSize(label, fs);
        page.drawText(label, { x: (PAGE_W - tw)/2, y: MARGIN + 8, size: fs, font, color: rgb(0.25,0.25,0.25) });
      }
    }

    // save & print
    const outDir = path.join(process.cwd(), "printed_image");
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
    const pad2 = (n)=>n.toString().padStart(2,"0");
    const now = new Date();
    const ts = `${now.getFullYear()}${pad2(now.getMonth()+1)}${pad2(now.getDate())}_${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
    const outPath = path.join(outDir, `print_4x6_${templateKey || "custom"}_${ts}.pdf`);

    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(outPath, pdfBytes);
    await printPDF(outPath);
    setTimeout(() => {
      fs.unlink(outPath, (err) => {
        if (err) console.warn("⚠️ Failed to delete PDF:", err.message);
        else console.log(`🗑️ Deleted temp PDF ${outPath}`);
      });
    }, 3000);

    return res.json({
      ok: true,
      message: `4x6 PDF created and sent to printer "${process.env.PRINTER_NAME}"`,
      pdfPath: outPath,
      overlayUsed: !!overlayAbs,
      slotsMode: slotsConfig ? "template-slots" : "auto-grid"
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to create PDF or print" });
  }
});

// 🔊 Play Sound API (cross-platform)
app.get("/play/:file", (req, res) => {
  const fileName = req.params.file; // e.g., 'sing.wav'

  // Folder where your sounds live (default: ./effect)
  const soundFolder = process.env.SOUND_FOLDER || path.join(process.cwd(), "effect");
  const soundFile = path.join(soundFolder, fileName);

  if (!fs.existsSync(soundFile)) {
    return res.status(404).json({ error: `Sound file ${fileName} not found` });
  }

  // --- helpers ---
  const winFFplay = (() => {
    const p = process.env.FFPLAY_PATH; 
    if (p && fs.existsSync(p)) return p;
    return "ffplay";
  })();

  let command;
  let args = [];

  if (process.platform !== "win32" && process.platform !== "darwin") {
    // Linux / Raspberry Pi → ใช้ aplay 
    command = "aplay";
    args = [soundFile];
  } else if (process.platform === "darwin") {
    command = "afplay";
    args = [soundFile];
  } else {
    // Windows → พยายามใช้ ffplay
    command = winFFplay;
    args = ["-nodisp", "-autoexit", "-loglevel", "quiet", soundFile];
  }

  // พยายามเล่นแบบ async
  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();

    console.log(`🔊 Playing sound asynchronously via ${command}: ${soundFile}`);
    return res.json({ ok: true, player: command, file: soundFile });
  } catch (err) {
    const isWin = process.platform === "win32";
    const triedFFplay =
      isWin && typeof command === "string" && command.toLowerCase().includes("ffplay");

    if (isWin && triedFFplay) {
      try {
        const psPath = soundFile.replace(/\\/g, "\\\\"); // escape backslash  PowerShell
        const psArgs = [
          "-NoProfile",
          "-WindowStyle",
          "Hidden",
          "-Command",
          `"[System.Reflection.Assembly]::LoadWithPartialName('System.Media') | Out-Null; $p = New-Object System.Media.SoundPlayer('${psPath}'); $p.Play();"`,
        ];
        const ps = spawn("powershell.exe", psArgs, {
          detached: true,
          stdio: "ignore",
          windowsHide: true,
        });
        ps.unref();

        console.log(`🔊 Windows fallback → PowerShell SoundPlayer: ${soundFile}`);
        return res.json({ ok: true, player: "powershell SoundPlayer (fallback)", file: soundFile });
      } catch (e2) {
        console.error("Play fallback failed:", e2?.message || e2);
        return res.status(500).json({ ok: false, error: "Failed to play sound on Windows fallback." });
      }
    }

    console.error("Play failed:", err?.message || err);
    return res.status(500).json({ ok: false, error: "Failed to play sound." });
  }
});

// 🩺 Health Check
app.get("/", (req, res) => {
  res.send("✅ Print API is running");
});

const PORT = process.env.PRINT_API_PORT || 5000;
const HOST = process.env.PRINT_API_HOST || "127.0.0.1";
app.listen(PORT, HOST, () => {
  // Print ENV summary
  const envSummary = {
    printer: process.env.PRINTER_NAME || "NOT SET",
    host: HOST,
    port: PORT,
  };
  console.log("[ENV]", envSummary);
  console.log(`printer service running`);
  console.log(`🖨 Printer and 🔊 sound ready to use`);
});
