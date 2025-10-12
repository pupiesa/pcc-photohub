import express from "express";
import fs from "fs";
import path from "path";
import { PDFDocument, rgb, StandardFonts, degrees } from "pdf-lib";
import { exec, spawn } from "child_process";
import cors from "cors";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// ----- CORS -----
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

// ----- Print helper -----
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

// ======== NEW: helpers for template / slots ========
const templatesRoot = path.join(__dirname, "templates");

/**
 * Template schema (ตัวอย่าง):
 * {
 *   "page": { "widthPt": 288, "heightPt": 432 },
 *   "overlayLayer": "background" | "foreground",    // เริ่มต้น: "background"
 *   "overlayPath": "overlay.png",                   // ถ้าไม่ระบุจะพยายามโหลด overlay.png ในโฟลเดอร์
 *   "slots": [
 *     { "x":17, "y":288.5, "w":120, "h":80,
 *       "rotateDeg": 0,               // หมุนรูปตาม slot (องศา)
 *       "srcIndex": 0,                // เลือกรูปจาก req.body.paths ตาม index (อนุญาตซ้ำ/duplicate)
 *       "fit": "cover" | "contain",   // เริ่มต้น: "contain"
 *       "layer": "under" | "over"     // วางใต้หรือทับ overlay (เริ่มต้น: "under")
 *     }
 *   ]
 * }
 */

// ปรับขนาด + จัดวางภาพตามโหมด fit
function computeImagePlacement(img, slot) {
  const { w: slotW, h: slotH } = slot;
  const fitMode = (slot.fit || "contain").toLowerCase(); // "contain" | "cover"

  const scaleContain = Math.min(slotW / img.width, slotH / img.height);
  const scaleCover   = Math.max(slotW / img.width, slotH / img.height);
  const scale = fitMode === "cover" ? scaleCover : scaleContain;

  const drawW = img.width * scale;
  const drawH = img.height * scale;
  const x = slot.x + (slotW - drawW) / 2;
  const y = slot.y + (slotH - drawH) / 2;

  return { x, y, drawW, drawH };
}

async function embedImage(pdfDoc, entry) {
  if (entry.kind === "base64") {
    const m = entry.value.match(/^data:(image\/(?:png|jpeg|jpg));base64,(.+)$/i);
    if (!m) throw new Error("Invalid data URL");
    const bytes = Buffer.from(m[2], "base64");
    return /png$/i.test(m[1]) ? pdfDoc.embedPng(bytes) : pdfDoc.embedJpg(bytes);
  } else {
    const bytes = fs.readFileSync(entry.value);
    return entry.value.toLowerCase().endsWith(".png") ? pdfDoc.embedPng(bytes) : pdfDoc.embedJpg(bytes);
  }
}

function resolveIfExists(p) {
  try {
    if (typeof p === "string" && p.startsWith("data:image/")) return { kind: "base64", value: p };
    const abs = path.isAbsolute(p) ? path.normalize(p) : null;
    if (abs && fs.existsSync(abs)) return { kind: "fs", value: abs };
    const rel = path.normalize(path.isAbsolute(p) ? p : path.join(process.cwd(), p));
    if (fs.existsSync(rel)) return { kind: "fs", value: rel };
    return null;
  } catch { return null; }
}

function pad2(n){ return n.toString().padStart(2,"0"); }

// ======== Create & Print PDF (upgraded) ========
app.post("/print", async (req, res) => {
  const { paths, templateKey, slots, footerText, footerH, overlayPath } = req.body;

  if (!paths || !Array.isArray(paths) || paths.length === 0) {
    return res.status(400).json({ error: "No paths provided" });
  }

  // resolve input images
  const resolved = [], missing = [];
  for (const p of paths) {
    const r = resolveIfExists(p);
    if (r) resolved.push(r); else missing.push(p);
  }
  if (resolved.length === 0) {
    return res.status(400).json({ error: "No valid image files found on server", missing, cwd: process.cwd() });
  }

  // template folder & json
  const baseDir = templateKey ? path.join(templatesRoot, templateKey) : null;
  const confPath = baseDir ? path.join(baseDir, "template.json") : null;

  // load template.json if exists
  let template = { page: {}, overlayLayer: "background", slots: null, overlayPath: null };
  if (confPath && fs.existsSync(confPath)) {
    try {
      template = Object.assign(template, JSON.parse(fs.readFileSync(confPath, "utf8")));
    } catch (e) {
      console.warn("template.json parse error:", e?.message || e);
    }
  }

  // page size
  const PAGE_W = Number.isFinite(template?.page?.widthPt)  ? template.page.widthPt  : 288;
  const PAGE_H = Number.isFinite(template?.page?.heightPt) ? template.page.heightPt : 432;

  // overlay path (prefer body.overlayPath > template.overlayPath > auto overlay.png)
  let overlayAbs = null;
  const overlayCandidate =
    overlayPath ||
    template.overlayPath ||
    (baseDir ? path.join(baseDir, "overlay.png") : null);

  if (overlayCandidate) {
    const r = resolveIfExists(overlayCandidate);
    overlayAbs = r?.value || null;
  }

  // slots: prefer req.body.slots > template.slots
  let slotsConfig = Array.isArray(slots) ? slots : (Array.isArray(template.slots) ? template.slots : null);

  // fallback: auto grid (ยังคงไว้กรณีไม่มี template)
  const USE_AUTO_GRID = !slotsConfig || slotsConfig.length === 0;

  // debug logs
  console.log("[TEMPLATE] root:", templatesRoot);
  console.log("[TEMPLATE] baseDir:", baseDir);
  console.log("[TEMPLATE] confPath exists?:", !!(confPath && fs.existsSync(confPath)));
  console.log("[TEMPLATE] overlayPath used:", overlayAbs || "(none)");
  console.log("[TEMPLATE] slots mode:", USE_AUTO_GRID ? "auto-grid" : "template-slots");
  console.log("[TEMPLATE] overlayLayer:", template.overlayLayer || "background");  //foreground or background

  try {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([PAGE_W, PAGE_H]);

    // bg white
    page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: rgb(1,1,1) });

    // ----- overlay background -----
    const overlayLayer = (template.overlayLayer || "background").toLowerCase();
    let overlayImg = null;
    if (overlayAbs && fs.existsSync(overlayAbs)) {
      const ovBytes = fs.readFileSync(overlayAbs);
      overlayImg = overlayAbs.toLowerCase().endsWith(".png")
        ? await pdfDoc.embedPng(ovBytes)
        : await pdfDoc.embedJpg(ovBytes);
      if (overlayLayer === "background") {
        page.drawImage(overlayImg, { x: 0, y: 0, width: PAGE_W, height: PAGE_H });
      }
    }

    if (USE_AUTO_GRID) {
      const MARGIN = 10, GUTTER = 8;
      const FOOTER_H_DEFAULT = 120, SLOT_ASPECT = 3/2, FRAME_PAD = 4, BORDER_W = 0.8;
      const FOOTER_H = Number.isFinite(footerH) ? Math.max(0, footerH) : FOOTER_H_DEFAULT;

      const GRID_W = PAGE_W - MARGIN * 2, GRID_H = PAGE_H - MARGIN * 2 - FOOTER_H;
      const cellW = (GRID_W - GUTTER) / 2, cellH = (GRID_H - GUTTER) / 2;
      const slotW = Math.min(cellW, cellH * SLOT_ASPECT);
      const slotH = slotW / SLOT_ASPECT;

      let plan;
      if (resolved.length === 1) plan = [0,0,0,0];
      else if (resolved.length === 2) plan = [0,1,1,0];
      else plan = [0,1,2,3];

      for (let i = 0; i < 4; i++) {
        const img = await embedImage(pdfDoc, resolved[ plan[i] % resolved.length ]);
        const row = Math.floor(i / 2), col = i % 2;
        const cellX = MARGIN + col * (cellW + GUTTER);
        const cellY = PAGE_H - MARGIN - FOOTER_H - (row + 1) * cellH - row * GUTTER;
        const slotX = cellX + (cellW - slotW) / 2;
        const slotY = cellY + (cellH - slotH) / 2;

        // frame
        page.drawRectangle({ x: slotX, y: slotY, width: slotW, height: slotH, color: rgb(1,1,1),
          borderColor: rgb(0.8,0.8,0.8), borderWidth: BORDER_W });

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

    } else {
      // ---------- TEMPLATE SLOTS (ใหม่) ----------
      // รองรับจำนวน slot เท่าใดก็ได้ และสามารถ duplicate ผ่าน srcIndex
      // วาดสองรอบ: 1) layer = under  2) layer = over
      const passes = ["under", "over"];

      for (const pass of passes) {
        for (let i = 0; i < slotsConfig.length; i++) {
          const slot = slotsConfig[i];

          // เลเยอร์ไม่ตรงรอบ → ข้าม
          const slotLayer = (slot.layer || "under").toLowerCase();
          if (slotLayer !== pass) continue;

          // เลือกรูปตาม srcIndex (ถ้าไม่กำหนด ใช้ i)
          const pick = Number.isInteger(slot.srcIndex) ? slot.srcIndex : i;
          const imgEntry = resolved[ ((pick % resolved.length) + resolved.length) % resolved.length ];
          const img = await embedImage(pdfDoc, imgEntry);

          // จัดวางตาม fit
          const { x, y, drawW, drawH } = computeImagePlacement(img, slot);

          // หมุนภาพ (ถ้าระบุ)
          const rotateDeg = Number.isFinite(slot.rotateDeg) ? slot.rotateDeg : 0;

          page.drawImage(img, {
            x, y, width: drawW, height: drawH,
            rotate: rotateDeg ? degrees(rotateDeg) : undefined
          });
        }

        // หลังวาด pass "under" เสร็จ → ถ้า overlay ต้องเป็น foreground ให้ตอนนี้วาด overlay
        if (pass === "under" && overlayImg && overlayLayer === "foreground") {
          page.drawImage(overlayImg, { x: 0, y: 0, width: PAGE_W, height: PAGE_H });
        }
      }
    }

    // บันทึก & พิมพ์
    const outDir = path.join(process.cwd(), "printed_image");
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const now = new Date();
    const ts = `${now.getFullYear()}${pad2(now.getMonth()+1)}${pad2(now.getDate())}_${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
    const outPath = path.join(outDir, `print_${templateKey || "custom"}_${ts}.pdf`);

    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(outPath, pdfBytes);
    await printPDF(outPath);

    const autoDel = String(process.env.AUTO_DELETE_PDF_AFTER_PRINT || "").toLowerCase();
    if (autoDel === "1" || autoDel === "true" || autoDel === "yes") {
      setTimeout(() => {
        fs.unlink(outPath, (err) => {
          if (err) console.warn("⚠️ Failed to delete PDF:", err.message);
          else console.log(`🗑️ Deleted temp PDF ${outPath}`);
        });
      }, 3000);
    } else {
      console.log("ℹ️ AUTO_DELETE_PDF_AFTER_PRINT is disabled; file kept:", outPath);
    }

    return res.json({
      ok: true,
      message: `PDF created and sent to printer "${process.env.PRINTER_NAME}"`,
      pdfPath: outPath,
      overlayUsed: !!overlayAbs,
      slotsMode: USE_AUTO_GRID ? "auto-grid" : "template-slots",
      page: { widthPt: PAGE_W, heightPt: PAGE_H }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to create PDF or print" });
  }
});

// ----- Play Sound API (เหมือนเดิม) -----
app.get("/play/:file", (req, res) => {
  const fileName = req.params.file;
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
    command = winFFplay; args = ["-nodisp","-autoexit","-loglevel","quiet", soundFile];
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

// ----- Health check -----
app.get("/", (req, res) => res.send("✅ Print API is running"));

const PORT = process.env.PRINT_API_PORT || 5000;
const HOST = process.env.PRINT_API_HOST || "127.0.0.1";
app.listen(PORT, HOST, () => {
  const envSummary = {
    printer: process.env.PRINTER_NAME || "NOT SET",
    host: HOST,
    port: PORT,
    autoDeletePDF: process.env.AUTO_DELETE_PDF_AFTER_PRINT || "false",
  };
  console.log("[ENV]", envSummary);
  console.log(`printer service running`);
  console.log(`🖨 Printer and 🔊 sound ready to use`);
});
