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

  const validPaths = paths.filter((p) => fs.existsSync(p));
  if (validPaths.length === 0) {
    return res.status(400).json({ error: "No valid files found" });
  }

  try {
    const pdfDoc = await PDFDocument.create();

    const A4_WIDTH = 595;
    const A4_HEIGHT = 842;
    const HALF_HEIGHT = A4_HEIGHT / 2;

    const page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);

    // 🖼 Draw images with 5% margins
    for (let i = 0; i < validPaths.length; i++) {
      const imgPath = validPaths[i];
      const imgBytes = fs.readFileSync(imgPath);

      let image;
      if (imgPath.toLowerCase().endsWith(".png")) {
        image = await pdfDoc.embedPng(imgBytes);
      } else {
        image = await pdfDoc.embedJpg(imgBytes);
      }

      const maxWidth = A4_WIDTH * 0.9;
      const maxHeight = HALF_HEIGHT * 0.9;

      const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
      const scaledWidth = image.width * scale;
      const scaledHeight = image.height * scale;

      const x = (A4_WIDTH - scaledWidth) / 2;
      const y =
        i === 0
          ? HALF_HEIGHT + (HALF_HEIGHT - scaledHeight) / 2
          : (HALF_HEIGHT - scaledHeight) / 2;

      page.drawImage(image, { x, y, width: scaledWidth, height: scaledHeight });
    }

    // ✍️ Draw centered text
    const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const text = "PCC-PhotoBooth";
    const fontSize = 20;
    const textWidth = font.widthOfTextAtSize(text, fontSize);
    const textX = (A4_WIDTH - textWidth) / 2;
    const textY = (A4_HEIGHT - fontSize) / 2;

    page.drawText(text, {
      x: textX,
      y: textY,
      size: fontSize,
      font,
      color: rgb(0, 0, 0),
    });

    // 📂 Ensure printed_image folder exists
    const folderPath = path.join(process.cwd(), "printed_image");
    if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath);

    // 🕒 Human-readable timestamp filename
    const now = new Date();
    const pad = (n) => n.toString().padStart(2, "0");
    const timestamp = `${now.getFullYear()}${pad(
      now.getMonth() + 1
    )}${pad(now.getDate())}_${pad(now.getHours())}${pad(
      now.getMinutes()
    )}${pad(now.getSeconds())}`;
    const fileName = `print_${timestamp}.pdf`;
    const outputPath = path.join(folderPath, fileName);

    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(outputPath, pdfBytes);
    console.log(`✅ Combined PDF created at ${outputPath}`);

    // 🖨 Automatically print
    await printPDF(outputPath);

    res.json({
      message: `Combined PDF created and sent to printer "${process.env.PRINTER_NAME}"`,
      pdfPath: outputPath,
      files: validPaths,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create PDF or print" });
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
