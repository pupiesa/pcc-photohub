"use client";

import { useEffect, useRef, useState } from "react";
import { client } from "@/lib/photoboothClient";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Loader } from "@/components/ui/shadcn-io/ai/loader";
import { toast } from "sonner";

/* ---------- Inline Soft Keyboard (ตัวเลข/OTP) ---------- */
function InlineOtpKeypad({ visible, setValue, onDone, maxLen = 6 }) {
  if (!visible) return null;
  const keys = ["1","2","3","4","5","6","7","8","9","0"];
  const press = (k) => {
    if (k === "back") setValue((v) => v.slice(0, -1));
    else if (k === "clear") setValue("");
    else if (k === "paste") {
      navigator.clipboard.readText().then((t) => {
        setValue(String(t).replace(/\D/g, "").slice(0, maxLen));
      }).catch(() => {});
    } else setValue((v) => (v + k).replace(/\D/g, "").slice(0, maxLen));
  };
  return (
    <div className="mt-3 rounded-xl border p-3 bg-muted/30">
      <div className="grid grid-cols-3 gap-2">
        {keys.slice(0, 9).map((k) => (
          <Button key={k} variant="secondary" onClick={() => press(k)}>{k}</Button>
        ))}
        <Button variant="outline" onClick={() => press("clear")}>ล้าง</Button>
        <Button variant="secondary" onClick={() => press("0")}>0</Button>
        <Button variant="outline" onClick={() => press("back")}>ลบ</Button>
      </div>
      <div className="flex gap-2 pt-2 justify-between">
        <Button onClick={onDone}>เสร็จสิ้น</Button>
      </div>
    </div>
  );
}

/** ForgotPinDialog
 * props:
 *  - open, onOpenChange
 *  - phone: หมายเลขโทรศัพท์ของผู้ใช้ (จำเป็น)
 *  - afterReset(newPin): callback เมื่อรีเซ็ต PIN เสร็จ
 *
 * โฟล: email (readonly) -> otp -> pin1 -> pin2
 */
export default function ForgotPinDialog({ open, onOpenChange, phone, afterReset }) {
  const [step, setStep] = useState("email");      // 'email' | 'otp' | 'pin1' | 'pin2'
  const [email, setEmail] = useState("");         // ดึงจาก DB และ lock readOnly
  const [hasEmail, setHasEmail] = useState(false);

  const [otp, setOtp] = useState("");
  const [pin1, setPin1] = useState("");
  const [pin2, setPin2] = useState("");

  const [loading, setLoading] = useState(false);

  // soft keyboards
  const [showOtpKb, setShowOtpKb] = useState(false);
  const [showPin1Kb, setShowPin1Kb] = useState(false);
  const [showPin2Kb, setShowPin2Kb] = useState(false);

  const otpFirstSlotRef = useRef(null);

  // โหลดอีเมลทุกครั้งที่เปิด
  useEffect(() => {
    let mounted = true;
    const init = async () => {
      if (!open || !phone) return;
      setStep("email");
      setOtp(""); setPin1(""); setPin2("");
      setShowOtpKb(false); setShowPin1Kb(false); setShowPin2Kb(false);

      try {
        const res = await client.getUserByNumber(phone);
        const u = res?.data || {};
        if (!mounted) return;
        setEmail(u.gmail || "");
        setHasEmail(Boolean(u.gmail));
      } catch (e) {
        if (!mounted) return;
        setEmail("");
        setHasEmail(false);
      }
    };
    init();
    return () => { mounted = false; };
  }, [open, phone]);

  const goToOtp = async () => {
    if (!hasEmail || !email) {
      toast.error("ยังไม่ได้ยืนยันอีเมล จึงไม่มีสิทธิเปลี่ยน PIN");
      return;
    }
    setLoading(true);
    try {
     await client.requestEmailOTP({ number: phone, email, heading: 'Verify your PIN change' });
      toast.success("ส่งรหัส OTP ไปที่อีเมลแล้ว");
      setStep("otp");
      setTimeout(() => {
        setShowOtpKb(true);
        setTimeout(() => otpFirstSlotRef.current?.focus?.({ preventScroll: true }), 50);
      }, 50);
    } catch (e) {
      toast.error(`ส่ง OTP ไม่สำเร็จ: ${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async () => {
    if (otp.length !== 6) { toast.error("กรุณากรอก OTP 6 หลัก"); return; }
    setLoading(true);
    try {
      await client.confirmEmailOTP({ number: phone, email, otp });
      toast.success("ยืนยัน OTP สำเร็จ");
      setShowOtpKb(false);
      setStep("pin1");          // → สเต็ป รหัสครั้งที่ 1
      setShowPin1Kb(true);
    } catch (e) {
      toast.error(`OTP ไม่ถูกต้อง: ${e?.message || e}`);
    } finally { setLoading(false); }
  };

  const goToPin2 = () => {
    if (pin1.length !== 6) {
      toast.error("PIN ต้องมี 6 หลัก");
      return;
    }
    setShowPin1Kb(false);
    setStep("pin2");            // → สเต็ป รหัสครั้งที่ 2 (ยืนยัน)
    setShowPin2Kb(true);
  };

  const saveNewPin = async () => {
    if (pin2.length !== 6) { toast.error("PIN ต้องมี 6 หลัก"); return; }
    if (pin1 !== pin2) { toast.error("PIN ทั้งสองครั้งไม่ตรงกัน"); return; }
    setLoading(true);
    try {
      await client.changePin(phone, pin2); // เปลี่ยน PIN จริง
      toast.success("ตั้ง PIN ใหม่สำเร็จ");
      onOpenChange(false);
      afterReset?.(pin2);
    } catch (e) {
      toast.error(`ตั้ง PIN ใหม่ไม่สำเร็จ: ${e?.message || e}`);
    } finally { setLoading(false); }
  };

  // บล็อกตั้งแต่หน้าแรกถ้าไม่มีอีเมล
  const noEmailBlocked = step === "email" && (!hasEmail || !email);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>ลืม PIN</DialogTitle>
          <DialogDescription>
          </DialogDescription>
        </DialogHeader>

        {/* STEP: EMAIL (READONLY) */}
        {step === "email" && (
          <div className="space-y-3">
            <Label htmlFor="email">อีเมลลูกค้า</Label>
            <Input
              id="email"
              type="email"
              inputMode="email"
              value={email}
              readOnly
              placeholder="ยังไม่มีอีเมล"
              className="bg-muted/40"
            />
            {noEmailBlocked ? (
              <div className="text-sm text-rose-600">
                ยังไม่ได้ยืนยันอีเมล จึง <b>ไม่มีสิทธิเปลี่ยน PIN</b>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
              </div>
            )}
            <DialogFooter>
              <Button onClick={goToOtp} disabled={loading || noEmailBlocked}>
                {loading ? (<><Loader className="mr-2" />กำลังส่ง</>) : "ส่ง OTP"}
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* STEP: OTP */}
        {step === "otp" && (
          <div className="space-y-3">
            <Label>รหัส OTP 6 หลัก</Label>
            <div className="mt-2">
              <InputOTP maxLength={6} value={otp} onChange={(v)=> setOtp(v.replace(/\D/g,"").slice(0,6))}>
                <InputOTPGroup ref={otpFirstSlotRef}>
                  {[0,1,2,3,4,5].map((i)=>(<InputOTPSlot key={i} index={i}/>))}
                </InputOTPGroup>
              </InputOTP>
            </div>
            <div className="mt-2">
              <Button variant="outline" onClick={() => setShowOtpKb((s)=>!s)}>
                {showOtpKb ? "ซ่อนแป้นพิมพ์" : "แสดงแป้นพิมพ์จำลอง"}
              </Button>
            </div>
            <InlineOtpKeypad visible={showOtpKb} setValue={setOtp} onDone={() => setShowOtpKb(false)} />
            <DialogFooter>
              <Button onClick={verifyOtp} disabled={loading || otp.length !== 6}>
                {loading ? (<><Loader className="mr-2" />กำลังตรวจสอบ</>) : "ยืนยัน OTP"}
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* STEP: PIN1 */}
        {step === "pin1" && (
          <div className="space-y-4">
            <Card>
              <CardContent className="pt-6 space-y-4">
                <div>
                  <Label>ตั้ง PIN ใหม่ </Label>
                  <Input
                    readOnly
                    value={pin1.split("").join(" ")}
                    placeholder="_ _ _ _ _ _"
                    className="text-center text-2xl font-mono h-14"
                    onFocus={() => setShowPin1Kb(true)}
                  />
                  <div className="mt-2">
                    <Button variant="outline" onClick={()=>setShowPin1Kb((s)=>!s)}>
                      {showPin1Kb ? "ซ่อนแป้นพิมพ์" : "แสดงแป้นพิมพ์จำลอง"}
                    </Button>
                  </div>
                  <InlineOtpKeypad visible={showPin1Kb} setValue={setPin1} onDone={()=>setShowPin1Kb(false)} />
                </div>
              </CardContent>
            </Card>
            <DialogFooter>
              <Button onClick={goToPin2} disabled={pin1.length !== 6}>
                ถัดไป
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* STEP: PIN2 (CONFIRM) */}
        {step === "pin2" && (
          <div className="space-y-4">
            <Card>
              <CardContent className="pt-6 space-y-4">
                <div>
                  <Label>ยืนยัน PIN อีกครั้ง</Label>
                  <Input
                    readOnly
                    value={pin2.split("").join(" ")}
                    placeholder="_ _ _ _ _ _"
                    className="text-center text-2xl font-mono h-14"
                    onFocus={() => setShowPin2Kb(true)}
                  />
                  <div className="mt-2">
                    <Button variant="outline" onClick={()=>setShowPin2Kb((s)=>!s)}>
                      {showPin2Kb ? "ซ่อนแป้นพิมพ์" : "แสดงแป้นพิมพ์จำลอง"}
                    </Button>
                  </div>
                  <InlineOtpKeypad visible={showPin2Kb} setValue={setPin2} onDone={()=>setShowPin2Kb(false)} />
                </div>
              </CardContent>
            </Card>
            <DialogFooter>
              <Button onClick={saveNewPin} disabled={loading || pin2.length !== 6}>
                {loading ? (<><Loader className="mr-2" />กำลังบันทึก</>) : "บันทึก PIN ใหม่"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
