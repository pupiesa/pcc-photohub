import { useState, useEffect } from "react";
import axios from "axios";
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
  const [livePreviewKey, setLivePreviewKey] = useState(Date.now()); // Unique key for live preview refresh
  const [capturedImage, setCapturedImage] = useState(null); // Store captured image details
  const maxPhotos = 4;

  useEffect(() => {
    // Start live preview when the component mounts
    handleReturnToLive();
  }, []);

  const handleCapture = async () => {
    try {
      const response = await axios.post(
        `${API_BASE_URL}/capture`,
        {},
        {
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
      console.log("Capture response:", response.data);
      if (response.data.url) {
        setCapturedImage(`${API_BASE_URL}${response.data.url}`); // Use captured image URL
      } else {
        console.error("No URL in capture response");
        alert(
          "Failed to retrieve captured image. Check the console for details."
        );
      }
    } catch (error) {
      console.error(
        "Error capturing image:",
        error.response?.data || error.message
      );
      alert("Failed to capture image. Check the console for details.");
    }
  };

  const handleConfirmCapture = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/video_feed`, {
        headers: {
          "Content-Type": "application/json",
        },
      });
      console.log("Live preview refreshed:", response.data);
      setCapturedImage(null); // Clear captured image details
      setLivePreviewKey(Date.now()); // Refresh live preview
      setPhotosTaken((prev) => prev + 1); // Increment photos taken
    } catch (error) {
      console.error(
        "Error refreshing live preview:",
        error.response?.data || error.message
      );
      alert("Failed to refresh live preview. Check the console for details.");
    }
  };

  const handleReturnToLive = async () => {
    try {
      const response = await axios.post(
        `${API_BASE_URL}/return_live`,
        {},
        {
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
      console.log("Return to live response:", response.data);

      // Force the live preview to refresh
      setLivePreviewKey(Date.now());
    } catch (error) {
      console.error(
        "Error returning to live mode:",
        error.response?.data || error.message
      );
      alert("Failed to return to live mode. Check the console for details.");
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
          setPhotosTaken((prev) => prev + 1);
          handleCapture();
        }, 500);
        clearInterval(timer);
      }
    }, 1000);
  };

  const resetSession = () => {
    setPhotosTaken(0);
    setCountdown(null);
    handleReturnToLive();
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
          {/* Live Preview */}
          <div className="w-full h-64 bg-black rounded-lg overflow-hidden">
            {capturedImage ? (
              <img
                src={capturedImage}
                alt="Captured Image"
                className="w-full h-full object-cover"
                onError={(e) => {
                  console.error("Image failed to load:", capturedImage);
                  e.target.src = ""; // Clear the src if the image fails to load
                }}
              />
            ) : (
              <img
                src={`${API_BASE_URL}/video_feed?key=${livePreviewKey}`} // Add unique key to force refresh
                alt="Live Preview"
                className="w-full h-full object-cover"
              />
            )}
          </div>

          {capturedImage ? (
            <div className="w-full space-y-3">
              <Button
                onClick={handleConfirmCapture}
                className="w-full h-12 text-xl font-bold"
              >
                Confirm Image
              </Button>
              <Button
                variant="outline"
                onClick={startPhotoshoot}
                className="w-full h-12"
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
      </CardContent>
    </Card>
  );
};

export default PhotoboothInterface;
