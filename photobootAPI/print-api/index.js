import express from "express";
import fs from "fs";
import path from "path";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { exec } from "child_process";
import { spawn } from "child_process";
import cors from 'cors';

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
  const { paths } = req.body;

  if (!paths || !Array.isArray(paths) || paths.length === 0) {
    return res.status(400).json({ error: "No paths provided" });
  }

  // --- helpers ---
  const resolveIfExists = (p) => {
    try {
      if (typeof p === "string" && p.startsWith("data:image/")) {
        return { kind: "base64", value: p };
      }
      const tryAbs = path.isAbsolute(p) ? path.normalize(p) : null;
      if (tryAbs && fs.existsSync(tryAbs)) return { kind: "fs", value: tryAbs };

      const tryRel = path.normalize(path.isAbsolute(p) ? p : path.join(process.cwd(), p));
      if (fs.existsSync(tryRel)) return { kind: "fs", value: tryRel };

      return null;
    } catch {
      return null;
    }
  };

  const loadImage = async (pdfDoc, entry) => {
    if (entry.kind === "base64") {
      const m = entry.value.match(/^data:(image\/(?:png|jpeg|jpg));base64,(.+)$/i);
      if (!m) throw new Error("Invalid data URL");
      const mime = m[1];
      const bytes = Buffer.from(m[2], "base64");
      return /png$/i.test(mime) ? pdfDoc.embedPng(bytes) : pdfDoc.embedJpg(bytes);
    } else {
      const bytes = fs.readFileSync(entry.value);
      return entry.value.toLowerCase().endsWith(".png")
        ? pdfDoc.embedPng(bytes)
        : pdfDoc.embedJpg(bytes);
    }
  };

  // --- resolve inputs ---
  const resolved = [];
  const missing = [];
  for (const p of paths) {
    const r = resolveIfExists(p);
    if (r) resolved.push(r);
    else missing.push(p);
  }

  if (resolved.length === 0) {
    return res.status(400).json({
      error: "No valid image files found on server",
      missing,
      cwd: process.cwd(),
      hint: "Use absolute server paths or data:image base64",
    });
  }

  // --- choose 4 cells content (backward-compatible logic) ---
  let plan;
  if (resolved.length === 1) {
    // 1 รูป → ใส่ทั้ง 4 ช่อง
    plan = [resolved[0], resolved[0], resolved[0], resolved[0]];
  } else if (resolved.length === 2) {
    // 2 รูป → [1,2,2,1]
    plan = [resolved[0], resolved[1], resolved[1], resolved[0]];
  } else {
    // ≥4 รูป → เอา 4
    plan = resolved.slice(0, 4);
  }

  try {
    const pdfDoc = await PDFDocument.create();

    // 4x6 inch @ 72pt/in => 288 x 432 pt (portrait)
    const PAGE_W = 288;
    const PAGE_H = 432;

    const MARGIN = 10;
    const FOOTER_H = 32; // พื้นที่ข้อความล่าง
    const GRID_W = PAGE_W - MARGIN * 2;
    const GRID_H = PAGE_H - MARGIN * 2 - FOOTER_H;

    const COLS = 2;
    const ROWS = 2;
    const CELL_W = GRID_W / COLS;
    const CELL_H = GRID_H / ROWS;

    const page = pdfDoc.addPage([PAGE_W, PAGE_H]);

    // พื้นหลังขาว
    page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: rgb(1, 1, 1) });

    // โหลดและวางรูป
    for (let i = 0; i < 4; i++) {
      const entry = plan[i];
      const img = await loadImage(pdfDoc, entry);

      const row = Math.floor(i / COLS);
      const col = i % COLS;

      const innerPad = 4;
      const availW = CELL_W - innerPad * 2;
      const availH = CELL_H - innerPad * 2;

      const scale = Math.min(availW / img.width, availH / img.height);
      const w = img.width * scale;
      const h = img.height * scale;

      const cellX = MARGIN + col * CELL_W;
      const cellY = PAGE_H - MARGIN - FOOTER_H - (row + 1) * CELL_H;

      const x = cellX + (CELL_W - w) / 2;
      const y = cellY + (CELL_H - h) / 2;

      page.drawImage(img, { x, y, width: w, height: h });
    }

    page.drawRectangle({
      x: MARGIN,
      y: MARGIN + FOOTER_H - 18,
      width: PAGE_W - MARGIN * 2,
      height: 0.6,
      color: rgb(0.9, 0.9, 0.9),
    });

    
    const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const text = "Pcc Photo Booth";
    const fontSize = 12;
    const textWidth = font.widthOfTextAtSize(text, fontSize);
    page.drawText(text, {
      x: (PAGE_W - textWidth) / 2,
      y: MARGIN + 8,
      size: fontSize,
      font,
      color: rgb(0.25, 0.25, 0.25),
    });

    // save
    const folderPath = path.join(process.cwd(), "printed_image");
    if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath);

    const now = new Date();
    const pad = (n) => n.toString().padStart(2, "0");
    const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(
      now.getHours()
    )}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const fileName = `print_4x6_${ts}.pdf`;
    const outputPath = path.join(folderPath, fileName);

    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(outputPath, pdfBytes);

    await printPDF(outputPath);

    return res.json({
      ok: true,
      message: `4x6 PDF created and sent to printer "${process.env.PRINTER_NAME}"`,
      pdfPath: outputPath,
      used: plan.map((e) => (e.kind === "fs" ? e.value : "[base64]")),
      missing,
      layout: resolved.length === 1 ? "2x2 (1,1,1,1)" : resolved.length === 2 ? "2x2 (1,2,2,1)" : "2x2 first four",
      pageSizePt: { width: PAGE_W, height: PAGE_H },
      cwd: process.cwd(),
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
