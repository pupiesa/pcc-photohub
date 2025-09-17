import express from "express";
import fs from "fs";
import path from "path";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { exec } from "child_process";
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


// Function to send PDF to printer
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

// /print endpoint
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

    // Draw images with 5% margins
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
      const y = i === 0
        ? HALF_HEIGHT + (HALF_HEIGHT - scaledHeight) / 2
        : (HALF_HEIGHT - scaledHeight) / 2;

      page.drawImage(image, { x, y, width: scaledWidth, height: scaledHeight });
    }

    // Draw centered text
    const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const text = "PCC-PhotoBooth";
    const fontSize = 20;
    const textWidth = font.widthOfTextAtSize(text, fontSize);
    const textX = (A4_WIDTH - textWidth) / 2;
    const textY = (A4_HEIGHT - fontSize) / 2;

    page.drawText(text, { x: textX, y: textY, size: fontSize, font, color: rgb(0, 0, 0) });

    // Ensure printed_image folder exists
    const folderPath = path.join(process.cwd(), "printed_image");
    if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath);

    // Human-readable timestamp filename
    const now = new Date();
    const pad = (n) => n.toString().padStart(2, "0");
    const timestamp = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const fileName = `print_${timestamp}.pdf`;
    const outputPath = path.join(folderPath, fileName);

    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(outputPath, pdfBytes);
    // console.log(`✅ Combined PDF created at ${outputPath}`);

    // Automatically print
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

app.get("/", (req, res) => {
  res.send("✅ Print API is running");
});

const PORT = process.env.PRINT_API_PORT || 5000;
const HOST = process.env.PRINT_API_HOST || "127.0.0.1";

app.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
  console.log(`🖨 Printer set to: "${process.env.PRINTER_NAME || 'NOT SET'}"`);
});
