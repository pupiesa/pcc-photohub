// components/TermsLegal.js
"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader } from "@/components/ui/shadcn-io/ai/loader";

export default function TermsLegal({
  consent,
  setConsent,
  flowError,
  onBack,
  onNext,
  sending,
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>เงื่อนไขการใช้งาน</DialogTitle>
        <DialogDescription>โปรดอ่านและยอมรับก่อนรับรหัส OTP</DialogDescription>
      </DialogHeader>

      <div className="grid gap-4">
        <div className="grid gap-2">
          <ScrollArea className="h-44 rounded-md border p-3 text-sm leading-6">
            <ul className="list-disc pl-5 space-y-2">
              <li>ระบบจะส่ง <strong>รหัส OTP 6 หลัก</strong> ไปยังอีเมลที่คุณระบุ เพื่อใช้ยืนยันตัวตน</li>
              <li>อีเมลที่ยืนยันแล้ว จะใช้สำหรับ <strong>ลิงก์รูปภาพ และการแจ้งเตือนบริการ</strong> เท่านั้น</li>
              <li>กรุณาเก็บรักษา <strong>รหัส OTP และลิงก์แชร์</strong> ไว้เป็นความลับ เพื่อความปลอดภัยของคุณ</li>
              <li><strong>ข้อควรระวัง:</strong> การเปิดเผยรหัสหรือลิงก์แก่บุคคลอื่น อาจทำให้ข้อมูลรั่วไหล pccphoto-hub ไม่รับผิดชอบต่อความเสียหายที่เกิดจากการเผยแพร่เอง</li>
              <li>คุณยอมรับและอนุญาตให้ <strong>pccphoto-hub</strong> เก็บและใช้ข้อมูลที่เกี่ยวข้อง เพื่อการให้บริการและตามที่กฎหมายกำหนด</li>
              <li>คุณมีสิทธิ์ <strong>ขอแก้ไข หรือลบข้อมูล</strong> ตามสิทธิที่กฎหมายคุ้มครอง</li>
              <li>การดำเนินการต่อ ถือว่าคุณได้ <strong>ยอมรับเงื่อนไขและนโยบายความเป็นส่วนตัว</strong> แล้ว</li>
            </ul>
          </ScrollArea>

          <div className="flex items-start gap-2 pt-2">
            <Checkbox id="consent" checked={consent} onCheckedChange={(v) => setConsent(Boolean(v))} />
            <Label htmlFor="consent" className="text-sm leading-6">
              ฉันได้อ่านและยอมรับเงื่อนไขการใช้งานและนโยบายความเป็นส่วนตัว
            </Label>
          </div>
        </div>

        {flowError && <div className="text-sm text-red-600">{flowError}</div>}
      </div>

      <DialogFooter className="mt-2">
        <Button variant="outline" onClick={onBack}>กลับ</Button>
        <Button onClick={onNext} disabled={!consent || sending}>
          {sending ? (<><Loader size={16} className="mr-2" />กำลังส่ง…</>) : ("ถัดไป")}
        </Button>
      </DialogFooter>
    </>
  );
}
