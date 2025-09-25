"use client";

import { useState } from "react";
import { useEffect , useRef} from "react";
import { client } from "@/lib/photoboothClient"; // ใช้ ensureUserAndPin / getUserByNumber
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Phone, Shield, UserPlus } from "lucide-react";
import { Loader } from "@/components/ui/shadcn-io/ai/loader"; // ใช้ Loader ตามที่ต้องการ

const PRINT_HOST = (process.env.PRINT_API_HOST || "127.0.0.1");
const PRINT_PORT = (process.env.PRINT_API_PORT || "5000")
const PRINT_BASE = `http://${PRINT_HOST}:${PRINT_PORT}`;

/**
 * props:
 *  - onBack(): void
 *  - onLogin({ phone, pin, mode }): void   // mode: "login" | "signup"
 *  - onForgotPin?(phone: string): void     // เปิด dialog ลืม PIN
 */
const PhoneLoginCard = ({ onBack, onLogin, onForgotPin }) => {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [mode, setMode] = useState(null); // "login" | "signup"
  const [step, setStep] = useState("phone"); // "phone" | "otp" | "otpConfirm"
  const [isLoading, setIsLoading] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const hasPlayedSound = useRef(false);
  
  if (!hasPlayedSound.current) {
    fetch(`${PRINT_BASE}/play/phone.wav`);
    hasPlayedSound.current = true; 
  }

  const formatPhoneDisplay = (phone) => {
    if (phone.length <= 3) return phone;
    if (phone.length <= 6) return `${phone.slice(0, 3)}-${phone.slice(3)}`;
    return `${phone.slice(0, 3)}-${phone.slice(3, 6)}-${phone.slice(6)}`;
  };

  const handlePhoneSubmit = async () => {
    if (phoneNumber.length < 10) return;
    setIsLoading(true);
    setErrMsg("");
    try {
      // เช็คว่ามี user ไหม เพื่อกำหนดโฟลว์
      await client.getUserByNumber(phoneNumber);
      setMode("login");
      fetch(`${PRINT_BASE}/play/pass.wav`);
    } catch (e) {
      if (e?.status === 404) {
        setMode("signup");
        fetch(`${PRINT_BASE}/play/createpass.wav`);
      } else {
        setErrMsg("Unable to check user. Please try again.");
        setIsLoading(false);
        return;
      }
    }
    setStep("otp");
    setIsLoading(false);
  };

  const handleNextOrConfirm = async () => {
    if (step === "otp") {
      if (pin.length !== 6) return;
      if (mode === "signup") {
        setStep("otpConfirm"); // ให้ยืนยัน PIN อีกรอบ
        fetch(`${PRINT_BASE}/play/passagain.wav`);
      } else {
        onLogin?.({ phone: phoneNumber, pin, mode: "login" });
        //fetch(`${PRINT_BASE}/play/promo.wav`);
      }
      return;
    }
    if (step === "otpConfirm") {
      if (pin2.length !== 6) return;
      if (pin !== pin2) {
        setErrMsg("PINs do not match. Please try again.");
        fetch(`${PRINT_BASE}/play/passagainwrong.wav`);
        setPin2("");
        return;
      }
      onLogin?.({ phone: phoneNumber, pin, mode: "signup" });
      //fetch(`${PRINT_BASE}/play/promo.wav`);
    }
    
  };

  const handleNumberPad = (digit) => {
    if (step === "phone" && phoneNumber.length < 10) {
      setPhoneNumber((prev) => prev + digit);
    } else if (step === "otp" && pin.length < 6) {
      setPin((prev) => prev + digit);
    } else if (step === "otpConfirm" && pin2.length < 6) {
      setPin2((prev) => prev + digit);
    }
  };

  const handleBackspace = () => {
    if (step === "phone") setPhoneNumber((p) => p.slice(0, -1));
    else if (step === "otp") setPin((p) => p.slice(0, -1));
    else setPin2((p) => p.slice(0, -1));
  };

  const headerIcon =
    step === "phone" ? (
      <Phone className="w-6 h-6 text-blue-600 dark:text-blue-400" />
    ) : mode === "signup" ? (
      <UserPlus className="w-6 h-6 text-purple-600 dark:text-purple-400" />
    ) : (
      <Shield className="w-6 h-6 text-green-600 dark:text-green-400" />
    );

  const primaryDisabled =
    isLoading ||
    (step === "phone" && phoneNumber.length < 10) ||
    (step === "otp" && pin.length !== 6) ||
    (step === "otpConfirm" && pin2.length !== 6);

  return (
    <Card className="w-96 backdrop-blur-sm bg-white/95 dark:bg-gray-900/95 shadow-2xl border-2 dark:border-gray-700">
      <CardHeader className="space-y-1 pb-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => (step === "otpConfirm" ? setStep("otp") : onBack?.())}
          className="self-start p-2 h-auto hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>

        <div className="flex items-center justify-center space-x-2">
          {headerIcon}
          <Badge variant={step === "phone" ? "default" : "secondary"}>
            {step === "phone" ? "Step 1 of 3" : step === "otpConfirm" ? "Step 3 of 3" : "Step 2 of 3"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* STEP CONTENT */}
        {step === "phone" && (
          <div className="space-y-4">
            <div className="text-center space-y-2">
              <CardTitle className="text-xl">Enter your phone number</CardTitle>
              <CardDescription>We’ll use this to find your album.</CardDescription>
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone" className="text-gray-700 dark:text-gray-300">Phone Number</Label>
              <div className="relative">
                <Input
                  id="phone"
                  value={formatPhoneDisplay(phoneNumber)}
                  readOnly
                  placeholder="___-___-____"
                  className="text-center text-2xl font-mono h-16 text-gray-800 dark:text-gray-200 bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700"
                />
                <div className="absolute inset-y-0 left-3 flex items-center">
                  <Phone className="w-5 h-5 text-gray-400 dark:text-gray-500" />
                </div>
              </div>
            </div>
          </div>
        )}

        {step !== "phone" && (
          <div className="space-y-4">
            <div className="text-center space-y-2">
              <CardTitle className="text-xl">
                {mode === "signup" && step === "otp" ? "Create a 6-digit PIN" :
                 mode === "signup" && step === "otpConfirm" ? "Confirm your PIN" :
                 "Enter your 6-digit PIN"}
              </CardTitle>
              <CardDescription>{formatPhoneDisplay(phoneNumber)}</CardDescription>
            </div>
            <div className="space-y-2">
              <Label className="text-gray-700 dark:text-gray-300">PIN</Label>
              <Input
                value={(step === "otp" ? pin : pin2).split("").join(" ")}
                readOnly
                placeholder="_ _ _ _ _ _"
                className="text-center text-2xl font-mono h-16 text-gray-800 dark:text-gray-200 bg-gray-50 dark:bg-gray-800/50 tracking-widest border-gray-200 dark:border-gray-700"
              />
              {!!errMsg && <div className="text-xs text-rose-600 dark:text-rose-400">{errMsg}</div>}
            </div>
          </div>
        )}

        {/* Number Pad */}
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {[1,2,3,4,5,6,7,8,9].map((d) => (
              <Button
                key={d}
                variant="outline"
                size="lg"
                onClick={() => handleNumberPad(String(d))}
                className="h-14 text-xl font-semibold hover:bg-blue-50 hover:border-blue-300 dark:hover:bg-blue-900/30 dark:hover:border-blue-600 dark:border-gray-600"
                disabled={isLoading}
              >
                {d}
              </Button>
            ))}

            <Button
              variant="outline"
              size="lg"
              onClick={handleBackspace}
              className="h-14 text-lg hover:bg-red-50 hover:border-red-300 dark:hover:bg-red-900/30 dark:hover:border-red-600 dark:border-gray-600"
              disabled={isLoading}
            >
              ⌫
            </Button>

            <Button
              variant="outline"
              size="lg"
              onClick={() => handleNumberPad("0")}
              className="h-14 text-xl font-semibold hover:bg-blue-50 hover:border-blue-300 dark:hover:bg-blue-900/30 dark:hover:border-blue-600 dark:border-gray-600"
              disabled={isLoading}
            >
              0
            </Button>

            <Button
              onClick={step === "phone" ? handlePhoneSubmit : handleNextOrConfirm}
              size="lg"
              className="h-14 text-lg font-semibold bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 dark:from-blue-500 dark:to-purple-500 dark:hover:from-blue-600 dark:hover:to-purple-600"
              disabled={primaryDisabled}
            >
              {isLoading ? (
                <>
                  <Loader className="mr-2" />
                  Processing...
                </>
              ) : step === "phone" ? (
                <>Continue</>
              ) : step === "otp" && mode === "signup" ? (
                <>Next</>
              ) : (
                <>Confirm</>
              )}
            </Button>
          </div>

          {/* ลืม PIN เฉพาะโหมดล็อกอิน */}
          {step !== "phone" && mode === "login" && (
            <div className="text-center">
              <button
                type="button"
                className="text-sm text-blue-600 hover:underline"
                onClick={() => onForgotPin?.(phoneNumber)}
              >
                ลืม PIN ?
              </button>
            </div>
          )}
        </div>

        {/* Progress Indicator */}
        <div className="flex space-x-2 justify-center">
          <div className={`w-8 h-1 rounded-full ${step === "phone" ? "bg-blue-600 dark:bg-blue-400" : "bg-gray-300 dark:bg-gray-600"}`} />
          <div className={`w-8 h-1 rounded-full ${step !== "phone" ? "bg-blue-600 dark:bg-blue-400" : "bg-gray-300 dark:bg-gray-600"}`} />
          {mode === "signup" && (
            <div className={`w-8 h-1 rounded-full ${step === "otpConfirm" ? "bg-blue-600 dark:bg-blue-400" : "bg-gray-300 dark:bg-gray-600"}`} />
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default PhoneLoginCard;
