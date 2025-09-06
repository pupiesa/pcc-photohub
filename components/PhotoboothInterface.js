"use client";
import { useState, useEffect, useRef } from "react";
import axios from "axios";
import { client } from "@/lib/photoboothClient";            // ✅ ใช้ PhotoboothClient
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const API_BASE_URL = "http://192.168.0.117:8080";

const PhotoboothInterface = ({ user, onLogout }) => {
  const [countdown, setCountdown] = useState(null);
  const [photosTaken, setPhotosTaken] = useState(0);
  const [capturedImage, setCapturedImage] = useState(null);      // preview URL
  const [capturedServerPath, setCapturedServerPath] = useState(null); // ✅ path บนเซิร์ฟเวอร์
  const [uploading, setUploading] = useState(false);
  const [uploadInfo, setUploadInfo] = useState(null);            // { nextcloud_link, last_files, file_count }
  const maxPhotos = 2;

  const videoRef = useRef(null);
  const streamRef = useRef(null);

  useEffect(() => {
    // เริ่มกล้องตอน mount
    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          try { await videoRef.current.play(); } catch (_) {}
        }
      } catch (error) {
        console.error("Error accessing camera:", error);
        alert("Failed to access the camera. Please check your permissions.");
      }
    };
    startCamera();

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

  // กลับจากภาพที่ถ่าย → bind stream คืน
  useEffect(() => {
    if (!capturedImage && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      try { videoRef.current.play(); } catch (_) {}
    }
  }, [capturedImage]);

  const handleCapture = async () => {
    try {
      const res = await axios.post(
        `${API_BASE_URL}/capture`,
        {},
        { headers: { "Content-Type": "application/json" } }
      );
      const data = res.data || {};
      if (data.url) {
        const ts = Date.now();
        setCapturedImage(`${API_BASE_URL}${data.url}?ts=${ts}`);
        if (data.serverPath) {
          setCapturedServerPath(data.serverPath); // ✅ ต้องได้มาจาก backend
        } else {
          console.warn("No serverPath in capture response. Upload to Nextcloud will not work.");
        }
      } else {
        alert("Failed to retrieve captured image.");
      }
    } catch (error) {
      console.error("Error capturing image:", error.response?.data || error.message);
      alert("Failed to capture image. Check the console for details.");
    }
  };

  const handleConfirmCapture = async () => {
    if (!capturedServerPath) {
      alert("Server path for the captured file is missing. Please update /capture to return 'serverPath'.");
      return;
    }
    setUploading(true);
    try {
      // อัปไฟล์นี้เข้า Nextcloud + บันทึกลง Mongo
      const result = await client.uploadImageForUser({
        number: user.phone,                 // ใช้เบอร์ผู้ใช้เป็น id
        filePaths: [capturedServerPath],    // ส่งเป็น array
        folderName: user.phone,             // โฟลเดอร์บน Nextcloud (ปรับชื่อได้)
        // linkPassword: "1234",            // ถ้าต้องการตั้งรหัสลิงก์
        // note: "PCC Photobooth",          // ถ้า nextcloud-api รองรับ
        // expiration: "2025-12-31",        // วันหมดอายุลิงก์
      });

      setUploadInfo(result);                // { nextcloud_link, last_files, file_count }

      // เคลียร์ preview + เพิ่มตัวนับ
      setCapturedImage(null);
      setCapturedServerPath(null);
      setPhotosTaken((prev) => prev + 1);

      // กลับมา live
      if (videoRef.current && streamRef.current) {
        try { await videoRef.current.play(); } catch (_) {}
      }
    } catch (e) {
      console.error("Upload failed:", e?.message || e);
      alert("Upload failed. Check console for details.");
    } finally {
      setUploading(false);
    }
  };

  const handleRetake = async () => {
    // แค่กลับมา live, ไม่ต้องเรียก backend ก็ได้
    setCapturedImage(null);
    setCapturedServerPath(null);
    setCountdown(null);
    if (videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      try { await videoRef.current.play(); } catch (_) {}
    }
  };

  const startPhotoshoot = () => {
    let count = 3;
    setCountdown(count);
    const timer = setInterval(() => {
      count--;
      if (count > 0) {
        setCountdown(count);
      } else {
        setCountdown("📸");
        setTimeout(() => {
          setCountdown(null);
          handleCapture();
        }, 500);
        clearInterval(timer);
      }
    }, 1000);
  };

  const resetSession = () => {
    setPhotosTaken(0);
    setCountdown(null);
    setCapturedImage(null);
    setCapturedServerPath(null);
  };

  return (
    <Card className="w-96 h-[600px]">
      <CardContent className="flex flex-col gap-4 p-6 h-full">
        <div className="flex justify-between items-center">
          <CardTitle className="text-xl">Welcome!</CardTitle>
          <Button variant="outline" onClick={onLogout} className="text-sm">
            Logout
          </Button>
        </div>

        <CardDescription>Phone: {user.phone}</CardDescription>

        <div className="flex-1 flex flex-col justify-center items-center gap-6">
          {/* Live Preview + overlay */}
          <div className="w-full h-64 bg-black rounded-lg overflow-hidden relative">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              className="w-full h-full object-cover"
            />
            {capturedImage && (
              <img
                src={capturedImage}
                alt="Captured"
                className="absolute inset-0 w-full h-full object-cover"
              />
            )}
          </div>

          {capturedImage ? (
            <div className="w-full space-y-3">
              <Button
                onClick={handleConfirmCapture}
                className="w-full h-12 text-xl font-bold"
                disabled={uploading}
              >
                {uploading ? "Uploading..." : "Confirm Image"}
              </Button>
              <Button
                variant="outline"
                onClick={handleRetake}
                className="w-full h-12"
                disabled={uploading}
              >
                Retake Photo
              </Button>
            </div>
          ) : countdown ? (
            <div className="text-8xl font-bold text-center">{countdown}</div>
          ) : (
            <>
              <div className="text-center">
                <div className="text-6xl mb-4">📷</div>
                <div className="text-xl font-semibold">
                  Photos taken: {photosTaken}/{maxPhotos}
                </div>
              </div>

              <div className="w-full space-y-3">
                {photosTaken < maxPhotos ? (
                  <Button
                    onClick={startPhotoshoot}
                    className="w-full h-16 text-2xl font-bold"
                  >
                    Take Photo {photosTaken + 1}
                  </Button>
                ) : (
                  <div className="space-y-3">
                    <div className="text-center text-green-600 font-bold text-xl">
                      ✅ Session Complete!
                    </div>
                    <Button
                      onClick={resetSession}
                      className="w-full h-12 text-xl"
                    >
                      Start New Session
                    </Button>
                  </div>
                )}

                {photosTaken > 0 && photosTaken < maxPhotos && (
                  <Button
                    variant="outline"
                    onClick={resetSession}
                    className="w-full h-12"
                  >
                    Reset Session
                  </Button>
                )}
              </div>
            </>
          )}
        </div>

        <div className="text-center text-sm text-gray-500">
          Session: ฿50 • {maxPhotos} photos included
        </div>

        {uploadInfo && (
          <div className="text-xs mt-2 space-y-1">
            <div>
              Nextcloud Link:{" "}
              <a className="underline" href={uploadInfo.nextcloud_link} target="_blank">
                {uploadInfo.nextcloud_link}
              </a>
            </div>
            <div>Total files in DB: {uploadInfo.file_count}</div>
            {uploadInfo.last_files?.length > 0 && (
              <div>
                <div className="font-semibold">Last uploaded:</div>
                <ul className="list-disc pl-5">
                  {uploadInfo.last_files.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default PhotoboothInterface;
