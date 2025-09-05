"use client";
import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Phone, Shield, Loader2 } from "lucide-react";

const PhoneLoginCard = ({ onBack, onLogin }) => {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState("phone"); // "phone" or "otp"
  const [isLoading, setIsLoading] = useState(false);

  const handlePhoneSubmit = async () => {
    if (phoneNumber.length >= 10) {
      setIsLoading(true);
      // Simulate API call
      setTimeout(() => {
        setStep("otp");
        setIsLoading(false);
      }, 1000);
    }
  };

  const handleOtpSubmit = async () => {
    if (otp.length === 6) {
      setIsLoading(true);
      // Simulate API call
      setTimeout(() => {
        onLogin({ phone: phoneNumber });
        setIsLoading(false);
      }, 1000);
    }
  };

  const handleNumberPad = (digit) => {
    if (step === "phone" && phoneNumber.length < 10) {
      setPhoneNumber((prev) => prev + digit);
    } else if (step === "otp" && otp.length < 6) {
      setOtp((prev) => prev + digit);
    }
  };

  const handleBackspace = () => {
    if (step === "phone") {
      setPhoneNumber((prev) => prev.slice(0, -1));
    } else {
      setOtp((prev) => prev.slice(0, -1));
    }
  };

  const formatPhoneDisplay = (phone) => {
    if (phone.length <= 3) return phone;
    if (phone.length <= 6) return `${phone.slice(0, 3)}-${phone.slice(3)}`;
    return `${phone.slice(0, 3)}-${phone.slice(3, 6)}-${phone.slice(6)}`;
  };

  return (
    <Card className="w-96 backdrop-blur-sm bg-white/95 dark:bg-gray-900/95 shadow-2xl border-2 dark:border-gray-700">
      <CardHeader className="space-y-1 pb-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="self-start p-2 h-auto hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>

        <div className="flex items-center justify-center space-x-2">
          {step === "phone" ? (
            <Phone className="w-6 h-6 text-blue-600 dark:text-blue-400" />
          ) : (
            <Shield className="w-6 h-6 text-green-600 dark:text-green-400" />
          )}
          <Badge variant={step === "phone" ? "default" : "secondary"}>
            Step {step === "phone" ? "1" : "2"} of 2
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {step === "phone" ? (
          <div className="space-y-4">
            <div className="text-center space-y-2">
              <CardTitle className="text-xl">Enter Your phone number</CardTitle>
              <CardDescription>
                Enter your phone number to view your photos or access more
                features later.
              </CardDescription>
            </div>

            <div className="space-y-2">
              <Label
                htmlFor="phone"
                className="text-gray-700 dark:text-gray-300"
              >
                Phone Number
              </Label>
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
        ) : (
          <div className="space-y-4">
            <div className="text-center space-y-2">
              <CardTitle className="text-xl">Enter Pin</CardTitle>
              <CardDescription>
                Enter the 4-digit Pin{" "}
                <span className="font-medium">
                  {formatPhoneDisplay(phoneNumber)}
                </span>
              </CardDescription>
            </div>

            <div className="space-y-2">
              <Label htmlFor="otp" className="text-gray-700 dark:text-gray-300">
                Pin
              </Label>
              <Input
                id="otp"
                value={otp.split("").join(" ")}
                readOnly
                placeholder="_ _ _ _ _ _"
                className="text-center text-2xl font-mono h-16 text-gray-800 dark:text-gray-200 bg-gray-50 dark:bg-gray-800/50 tracking-widest border-gray-200 dark:border-gray-700"
              />
            </div>
          </div>
        )}

        {/* Number Pad */}
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
              <Button
                key={digit}
                variant="outline"
                size="lg"
                onClick={() => handleNumberPad(digit.toString())}
                className="h-14 text-xl font-semibold hover:bg-blue-50 hover:border-blue-300 dark:hover:bg-blue-900/30 dark:hover:border-blue-600 dark:border-gray-600"
                disabled={isLoading}
              >
                {digit}
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
              onClick={step === "phone" ? handlePhoneSubmit : handleOtpSubmit}
              size="lg"
              className="h-14 text-lg font-semibold bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 dark:from-blue-500 dark:to-purple-500 dark:hover:from-blue-600 dark:hover:to-purple-600"
              disabled={
                isLoading ||
                (step === "phone" && phoneNumber.length < 10) ||
                (step === "otp" && otp.length < 6)
              }
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : step === "phone" ? (
                <>Send Code</>
              ) : (
                <>Confirm</>
              )}
            </Button>
          </div>
        </div>

        {/* Progress Indicator */}
        <div className="flex space-x-2 justify-center">
          <div
            className={`w-8 h-1 rounded-full ${
              step === "phone"
                ? "bg-blue-600 dark:bg-blue-400"
                : "bg-green-600 dark:bg-green-400"
            }`}
          />
          <div
            className={`w-8 h-1 rounded-full ${
              step === "otp"
                ? "bg-blue-600 dark:bg-blue-400"
                : "bg-gray-300 dark:bg-gray-600"
            }`}
          />
        </div>
      </CardContent>
    </Card>
  );
};

export default PhoneLoginCard;
