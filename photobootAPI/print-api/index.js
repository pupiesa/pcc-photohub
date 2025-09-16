import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";

const app = express();
const upload = multer({ dest: "uploads/" }); // save uploads to "uploads/" folder

// Upload endpoint
app.post("/upload", upload.single("image"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No image uploaded" });
  }

  // Log file details to the console
  console.log("📥 New job uploaded:");
  console.log(`Original Name: ${req.file.originalname}`);
  console.log(`MIME Type: ${req.file.mimetype}`);
  console.log(`Size: ${req.file.size} bytes`);
  console.log(`Saved As: ${req.file.filename}`);
  console.log(`Path: ${req.file.path}`);
  console.log("--------------");

  // Respond to the client
  res.json({
    message: "Image uploaded successfully!",
    file: {
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      savedAs: req.file.filename,
      path: req.file.path,
    },
  });
});

app.get("/", (req, res) => {
  res.send("Server is running");
});

const PORT = 5000;
app.listen(PORT, '127.0.0.1', () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
