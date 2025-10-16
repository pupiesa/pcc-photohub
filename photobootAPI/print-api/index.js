import express from "express";
import fs from "fs";
import path from "path";
import { PDFDocument, rgb, StandardFonts, degrees } from "pdf-lib";
import { exec, spawn } from "child_process";
import cors from "cors";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app = express();

// ----------- CORS -----------
const raw = process.env.CORS_ALLOW_ORIGINS || "";
const allowlist = raw.split(",").map(s => s.trim()).filter(Boolean);
const allowNoOrigin = true;

// === env switches (ยังคงเดิม) ===
const AUTO_DELETE_PDF_AFTER_PRINT = String(process.env.AUTO_DELETE_PDF_AFTER_PRINT || "").toLowerCase() === "true";
const AUTO_DELETE_PDF_DELAY_MS = Number(process.env.AUTO_DELETE_PDF_DELAY_MS || 3000);

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

app.use(express.json({ limit: "25mb" }));
app.use(cors(corsOptions));

// ----------- Helpers -----------
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
      resolve(stdout?.trim?.() || "ok");
    });
  });
}

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

const embedOverlayIfExists = async (pdfDoc, page, overlayAbs) => {
  if (!overlayAbs || !fs.existsSync(overlayAbs)) return null;
  const ovBytes = fs.readFileSync(overlayAbs);
  const isPng = overlayAbs.toLowerCase().endsWith(".png");
  const img = isPng ? await pdfDoc.embedPng(ovBytes) : await pdfDoc.embedJpg(ovBytes);
  page.drawImage(img, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
  return img;
};

const scheduleDelete = (outPath) => {
  if (!AUTO_DELETE_PDF_AFTER_PRINT || !outPath) return;
  setTimeout(() => {
    fs.unlink(outPath, (err) => {
      if (err) console.warn("⚠️ Failed to delete PDF:", err.message);
      else console.log(`🗑️ Deleted temp PDF ${outPath}`);
    });
  }, AUTO_DELETE_PDF_DELAY_MS);
};

// ----------- /print -----------
/**
 * Body:
 * {
 *   paths: string[],
 *   templateKey?: string,                     // <-- ใช้เฉพาะค่าที่ส่งมา ถ้าไม่ส่ง = no-template (auto-grid)
 *   slots?: Array<{x,y,w,h,rotate?,src?,zoom?,ox?,oy?}>,
 *   overlayPath?: string,
 *   overlayLayer?: "below" | "above",
 *   footerText?: string, footerH?: number
 * }
 */
app.post("/print", async (req, res) => {
  const {
    paths,
    overlayPath: overlayPathOverride,
    overlayLayer: overlayLayerOverride,
    templateKey: templateKeyFromBody,
    slots: slotsFromBody,
    footerText,
    footerH,
  } = req.body;

  if (!paths || !Array.isArray(paths) || paths.length === 0) {
    return res.status(400).json({ error: "No paths provided" });
  }

  // ---------- defaults ----------
  let PAGE_W_DEFAULT = 288;  // 4x6 inch @ 72pt/in
  let PAGE_H_DEFAULT = 432;
  const MARGIN = 10, GUTTER = 8;
  const FOOTER_H_DEFAULT = 120, SLOT_ASPECT = 3/2, FRAME_PAD = 4, BORDER_W = 0.8;
  const FOOTER_H = Number.isFinite(footerH) ? Math.max(0, footerH) : FOOTER_H_DEFAULT;

  // ---------- resolve images ----------
  const resolved = [], missing = [];
  for (const p of paths) {
    const r = resolveIfExists(p);
    if (r) resolved.push(r); else missing.push(p);
  }
  if (resolved.length === 0) {
    return res.status(400).json({ error: "No valid image files found on server", missing, cwd: process.cwd() });
  }

  // ---------- template selection: ใช้เฉพาะค่าจาก body ----------
  const templatesRoot = path.join(__dirname, "templates");
  const usedTemplateKey = (typeof templateKeyFromBody === "string" && templateKeyFromBody.trim())
    ? templateKeyFromBody.trim()
    : null;

  const baseDir  = usedTemplateKey ? path.join(templatesRoot, usedTemplateKey) : null;
  const confPath = baseDir ? path.join(baseDir, "template.json") : null;

  let tpl = null;
  if (confPath && fs.existsSync(confPath)) {
    try { tpl = JSON.parse(fs.readFileSync(confPath, "utf8")); }
    catch (e) { console.warn("template.json parse error:", e?.message || e); }
  }

  // page size from template (ถ้าไม่มี template → ใช้ default)
  const PAGE_W = Number.isFinite(tpl?.page?.widthPt)  ? tpl.page.widthPt  : PAGE_W_DEFAULT;
  const PAGE_H = Number.isFinite(tpl?.page?.heightPt) ? tpl.page.heightPt : PAGE_H_DEFAULT;

  // slots: body > template.json > null
  const slotsConfig = Array.isArray(slotsFromBody) ? slotsFromBody
                     : (Array.isArray(tpl?.slots) ? tpl.slots : null);

  // overlay file and layer
  let overlayAbs = null;
  let overlayLayer = (overlayLayerOverride === "above" || overlayLayerOverride === "below")
    ? overlayLayerOverride
    : (tpl?.template?.layer === "above" || tpl?.template?.layer === "below" ? tpl.template.layer : "below");

  if (overlayPathOverride) {
    const r = resolveIfExists(overlayPathOverride);
    overlayAbs = r?.value || null;
  } else if (tpl?.template?.file) {
    const maybe = path.isAbsolute(tpl.template.file)
      ? tpl.template.file
      : (baseDir ? path.join(baseDir, tpl.template.file) : tpl.template.file);
    if (fs.existsSync(maybe)) overlayAbs = maybe;
  } else if (baseDir) {
    const candidates = ["overlay.png", "overlay.jpg", "overlay.jpeg"].map(n => path.join(baseDir, n));
    overlayAbs = candidates.find(p => fs.existsSync(p)) || null;
  }

  console.log("[TEMPLATE] using key:", usedTemplateKey || "(none)");
  console.log("[TEMPLATE] confPath exists?:", !!(confPath && fs.existsSync(confPath)));
  console.log("[TEMPLATE] overlayPath used:", overlayAbs || "(none)");
  console.log("[TEMPLATE] overlayLayer:", overlayLayer);
  console.log("[TEMPLATE] slots mode:", slotsConfig ? `template-slots (${slotsConfig.length})` : "auto-grid");

  let outPath = null;

  try {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([PAGE_W, PAGE_H]);

    // background white
    page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: rgb(1,1,1) });

    // embed all images
    const embedded = [];
    for (const r of resolved) embedded.push(await loadImage(pdfDoc, r));

    // overlay below
    if (overlayAbs && overlayLayer === "below") {
      await embedOverlayIfExists(pdfDoc, page, overlayAbs);
    }

    // draw by slots or fallback grid
    if (slotsConfig && slotsConfig.length > 0) {
      const nImgs = embedded.length;

      for (let i = 0; i < slotsConfig.length; i++) {
        const s = slotsConfig[i];
        const imgIdx = Number.isInteger(s.src) ? ((s.src % nImgs) + nImgs) % nImgs : (i % nImgs);
        const img = embedded[imgIdx];

        const zoom = Number.isFinite(s.zoom) ? Math.max(0.05, s.zoom) : 1.0;
        const drawW = s.w * zoom;
        const drawH = s.h * zoom;

        const offX = Number.isFinite(s.ox) ? s.ox : 0;
        const offY = Number.isFinite(s.oy) ? s.oy : 0;
        const x = s.x + (s.w - drawW) / 2 + offX;
        const y = s.y + (s.h - drawH) / 2 + offY;

        page.drawImage(img, {
          x, y, width: drawW, height: drawH,
          rotate: degrees(Number.isFinite(s.rotate) ? s.rotate : 0),
        });
      }
    } else {
      // fallback: 2x2 grid
      const GRID_W = PAGE_W - MARGIN * 2, GRID_H = PAGE_H - MARGIN * 2 - FOOTER_H;
      const cellW = (GRID_W - GUTTER) / 2, cellH = (GRID_H - GUTTER) / 2;
      const slotW = Math.min(cellW, cellH * SLOT_ASPECT);
      const slotH = slotW / SLOT_ASPECT;

      for (let i = 0; i < 4; i++) {
        const img = embedded[i % embedded.length];
        const row = Math.floor(i / 2), col = i % 2;
        const cellX = MARGIN + col * (cellW + GUTTER);
        const cellY = PAGE_H - MARGIN - FOOTER_H - (row + 1) * cellH - row * GUTTER;
        const slotX = cellX + (cellW - slotW) / 2;
        const slotY = cellY + (cellH - slotH) / 2;

        page.drawRectangle({
          x: slotX, y: slotY, width: slotW, height: slotH, color: rgb(1,1,1),
          borderColor: rgb(0.8,0.8,0.8), borderWidth: BORDER_W
        });

        const innerW = slotW - FRAME_PAD*2, innerH = slotH - FRAME_PAD*2;
        const scale = Math.min(innerW / img.width, innerH / img.height);
        const drawW = img.width * scale, drawH = img.height * scale;
        const imgX = slotX + FRAME_PAD + (innerW - drawW)/2;
        const imgY = slotY + FRAME_PAD + (innerH - drawH)/2;

        page.drawImage(img, { x: imgX, y: imgY, width: drawW, height: drawH });
      }

      // footer line + text
      page.drawRectangle({ x: MARGIN, y: MARGIN + FOOTER_H - 18,
        width: PAGE_W - MARGIN*2, height: 0.6, color: rgb(0.9,0.9,0.9) });

      const label = typeof footerText === "string" ? footerText : "Pcc Photo Booth";
      if (label) {
        const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
        const fs = 12, tw = font.widthOfTextAtSize(label, fs);
        page.drawText(label, { x: (PAGE_W - tw)/2, y: MARGIN + 8, size: fs, font, color: rgb(0.25,0.25,0.25) });
      }
    }

    // overlay above
    if (overlayAbs && overlayLayer === "above") {
      await embedOverlayIfExists(pdfDoc, page, overlayAbs);
    }

    // save file
    const outDir = path.join(process.cwd(), "printed_image");
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const pad2 = (n)=>n.toString().padStart(2,"0");
    const now = new Date();
    const ts = `${now.getFullYear()}${pad2(now.getMonth()+1)}${pad2(now.getDate())}_${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
    const outPath = path.join(outDir, `print_${usedTemplateKey || "custom"}_${ts}.pdf`);

    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(outPath, pdfBytes);

    // try to print
    try {
      await printPDF(outPath);
      scheduleDelete(outPath);
      return res.json({
        ok: true,
        message: `PDF created and sent to printer "${process.env.PRINTER_NAME}"`,
        pdfPath: outPath,
        templateKey: usedTemplateKey || null,
        overlayUsed: !!overlayAbs,
        overlayLayer,
        slotsMode: slotsConfig ? `template-slots (${slotsConfig.length})` : "auto-grid"
      });
    } catch (printErr) {
      console.error("❌ Print failed:", printErr?.message || printErr);
      scheduleDelete(outPath);
      return res.status(500).json({
        ok: false,
        error: "Failed to print",
        reason: String(printErr?.message || printErr),
        pdfPath: outPath,
        templateKey: usedTemplateKey || null
      });
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to create PDF or print" });
  }
});

// ----------- /play/:file (sound) -----------
app.get("/play/:file", (req, res) => {
  const fileName = req.params.file; // e.g., 'print.wav'
  const soundFolder = process.env.SOUND_FOLDER || path.join(process.cwd(), "effect");
  const soundFile = path.join(soundFolder, fileName);

  if (!fs.existsSync(soundFile)) {
    return res.status(404).json({ error: `Sound file ${fileName} not found` });
  }

  const winFFplay = (() => {
    const p = process.env.FFPLAY_PATH;
    if (p && fs.existsSync(p)) return p;
    return "ffplay";
  })();

  let command, args = [];
  if (process.platform !== "win32" && process.platform !== "darwin") {
    command = "aplay"; args = [soundFile];
  } else if (process.platform === "darwin") {
    command = "afplay"; args = [soundFile];
  } else {
    command = winFFplay;
    args = ["-nodisp", "-autoexit", "-loglevel", "quiet", soundFile];
  }

  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
    child.unref();
    console.log(`🔊 Playing sound asynchronously via ${command}: ${soundFile}`);
    return res.json({ ok: true, player: command, file: soundFile });
  } catch (err) {
    const isWin = process.platform === "win32";
    const triedFFplay = isWin && typeof command === "string" && command.toLowerCase().includes("ffplay");
    if (isWin && triedFFplay) {
      try {
        const psPath = soundFile.replace(/\\/g, "\\\\");
        const psArgs = [
          "-NoProfile","-WindowStyle","Hidden","-Command",
          `"[System.Reflection.Assembly]::LoadWithPartialName('System.Media') | Out-Null; $p = New-Object System.Media.SoundPlayer('${psPath}'); $p.Play();"`
        ];
        const ps = spawn("powershell.exe", psArgs, { detached: true, stdio: "ignore", windowsHide: true });
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

// ----------- Health check -----------
app.get("/", (req, res) => {
  res.send("✅ Print API is running");
});

const PORT = process.env.PRINT_API_PORT || 5000;
const HOST = process.env.PRINT_API_HOST || "127.0.0.1";
app.listen(PORT, HOST, () => {
  const envSummary = {
    printer: process.env.PRINTER_NAME || "NOT SET",
    host: HOST,
    port: PORT,
    autoDelete: AUTO_DELETE_PDF_AFTER_PRINT,
    deleteDelayMs: AUTO_DELETE_PDF_DELAY_MS
  };
  console.log("[ENV]", envSummary);
  console.log("printer service running");
  console.log("🖨 Printer and 🔊 sound ready to use");
});
