// components/ui/InlineKeyboards.js
"use client";

import { Button } from "@/components/ui/button";

// ปุ่มขนาดใหญ่สำหรับ kiosk
const keyBtn = "h-14 min-w-[3.2rem] text-lg rounded-xl";
const wideBtn = "h-14 px-5 text-lg rounded-xl bg-linear-65 from-purple-500 to-pink-500 text-white hover:opacity-80";
const wideBtn2 = "h-14 px-5 text-lg rounded-xl hover:opacity-80";


export function InlineOtpKeypad({ visible, setValue, onDone }) {
  if (!visible) return null;
  const keys = ["1","2","3","4","5","6","7","8","9","0"];
  const press = (k) => {
    if (k === "back") setValue((v) => v.slice(0, -1));
    else if (k === "clear") setValue("");
    else if (k === "paste") {
      navigator.clipboard.readText()
        .then((t) => setValue(String(t).replace(/\D/g, "").slice(0, 6)))
        .catch(() => {});
    } else {
      setValue((v) => (v + k).replace(/\D/g, "").slice(0, 6));
    }
  };
  return (
    <div className="mt-3 rounded-2xl border p-3 bg-muted/30">
      <div className="grid grid-cols-3 gap-3">
        {keys.slice(0, 9).map((k) => (
          <Button key={k} variant="secondary" className={keyBtn} onClick={() => press(k)}>{k}</Button>
        ))}
        <Button variant="destructive" className={wideBtn2} onClick={() => press("clear")}>ล้าง</Button>
        <Button variant="secondary" className={wideBtn2} onClick={() => press("0")}>0</Button>
        <Button variant="outline" className={wideBtn2} onClick={() => press("back")}>⌫</Button>
      </div>
      <div className="flex gap-3 pt-3 justify-end">
        <Button className={wideBtn2} onClick={onDone}>เสร็จสิ้น</Button>
      </div>
    </div>
  );
}

export function InlineEmailKeyboard({ visible, setValue, onDone }) {
  if (!visible) return null;

  const rows = [
    ["1","2","3","4","5","6","7","8","9","0"],
    ["q","w","e","r","t","y","u","i","o","p"],
    ["a","s","d","f","g","h","j","k","l","@"],
    ["z","x","c","v","b","n","m",".","_","-"],
  ];

  const domainOptions = ["@gmail.com", "@kmitl.ac.th","@outlook.com"];

  const press = (k) => {
    if (k === "back") setValue((v) => v.slice(0, -1));
    else if (k === "clear") setValue("");
    else if (k === "paste") {
      navigator.clipboard.readText().then((t) => setValue(String(t))).catch(() => {});
    } else {
      setValue((v) => (v + k).slice(0, 254));
    }
  };

  return (
    <div className="mt-3 rounded-2xl border p-3 bg-muted/30">
      {/* domain shortcuts */}
      <div className="flex flex-wrap gap-2 mb-2">
        {domainOptions.map((d) => (
          <Button key={d} variant="secondary" className={wideBtn} onClick={() => press(d)}>
            {d}
          </Button>
        ))}
      </div>

      {/* rows */}
      <div className="space-y-2">
        {rows.map((row, idx) => (
          <div key={idx} className="flex gap-2 justify-center">
            {row.map((k) => (
              <Button key={k} variant="secondary" className={keyBtn} onClick={() => press(k)}>
                {k}
              </Button>
            ))}
          </div>
        ))}
      </div>

      {/* controls */}
      <div className="flex gap-2 justify-end mt-3">
        <Button variant="destructive" className={wideBtn2} onClick={() => press("clear")}>ล้าง</Button>
        <Button variant="outline" className={wideBtn2} onClick={() => press("back")}>⌫</Button>
        <Button className={wideBtn2} onClick={onDone}>เสร็จสิ้น</Button>
      </div>
    </div>
  );
}
