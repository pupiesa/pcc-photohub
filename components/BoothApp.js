import { useState } from "react";
import { client } from "@/lib/photoboothClient";
import PhoneLoginCard from "@/components/PhoneLoginCard";
import PhotoboothInterface from "@/components/PhotoboothInterface";
import { Card } from "@/components/ui/card";

export default function BoothApp() {
  const [stage, setStage] = useState("login"); // "login" | "booth"
  const [user, setUser] = useState(null);      // { phone }
  const [notice, setNotice] = useState(null);  // ข้อความแจ้งเตือน/ผลลัพธ์
  const [busy, setBusy] = useState(false);

  const handleLogin = async ({ phone, pin }) => {
    setBusy(true);
    setNotice(null);
    try {
      // ขั้นตอน: ถ้ามี user อยู่แล้ว → เช็ค PIN; ถ้าไม่มี → สร้าง user แล้วค่อยเช็ค
      // ฟังก์ชันนี้จะ throw ถ้า PIN ไม่ตรง
      const before = await client.getUserByNumber(phone).catch(e => e); // ดูว่ามีมาก่อนไหม
      const existed = !(before instanceof Error);

      await client.ensureUserAndPin({ number: phone, pin });

      if (!existed) {
        setNotice("✅ สร้างผู้ใช้ใหม่เรียบร้อย");
      } else {
        setNotice("✅ เข้าสู่ระบบสำเร็จ");
      }

      setUser({ phone });
      setStage("booth");
    } catch (e) {
      if (e?.status === 401) {
        setNotice("❌ รหัสผิด กรุณาลองใหม่");
      } else {
        setNotice(`⚠️ เข้าสู่ระบบไม่สำเร็จ: ${e?.message || "REQUEST_FAILED"}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = () => {
    setUser(null);
    setStage("login");
    setNotice(null);
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center">
      <div className="space-y-3">
        {stage === "login" ? (
          <>
            {notice && (
              <Card className="p-3 text-sm">
                {notice}
              </Card>
            )}
            <PhoneLoginCard
              onBack={() => {}}
              onLogin={busy ? () => {} : handleLogin}
            />
          </>
        ) : (
          <>
            {notice && (
              <Card className="p-3 text-sm">
                {notice}
              </Card>
            )}
            <PhotoboothInterface user={user} onLogout={handleLogout} />
          </>
        )}
      </div>
    </div>
  );
}
