"use client";
import React, { useEffect, useRef, useState } from "react";
import { Input } from "./ui/input";

const CODE_LEN = 8;

const PromotionCard = ({ details, onRedeem }) => {
  const [code, setCode] = useState("");
  const [autoing, setAutoing] = useState(false);
  const lastAutoCodeRef = useRef("");

  const label =
    details?.type === "percent"
      ? `${details.value}% off`
      : details?.type === "amount" || details?.type === "fixed"
      ? `฿${details.value} off`
      : "";

  const fmt = (s) => (s ? new Date(s).toLocaleDateString() : "");
  const normalize = (s) => String(s || "").toUpperCase().replace(/\s+/g, "");

  // Auto redeem เมื่อครบ 8 ตัว (debounce 300ms กันเด้งซ้ำ)
  useEffect(() => {
    const n = normalize(code);
    if (n.length === CODE_LEN && n !== lastAutoCodeRef.current) {
      setAutoing(true);
      const id = setTimeout(async () => {
        try {
          lastAutoCodeRef.current = n;
          await onRedeem?.(n);
        } finally {
          setAutoing(false);
        }
      }, 300);
      return () => clearTimeout(id);
    }
  }, [code, onRedeem]);

  const handleKeyDown = async (e) => {
    if (e.key === "Enter") {
      const n = normalize(code);
      if (n.length === CODE_LEN) {
        setAutoing(true);
        try {
          lastAutoCodeRef.current = n;
          await onRedeem?.(n);
        } finally {
          setAutoing(false);
        }
      }
    }
  };

  const ncode = normalize(code);

  return (
    <div className="flex justify-center">
      <div className="p-4 rounded-md shadow-md border bg-white dark:bg-gray-800 w-[320px]">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Input
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Coupon`}
            maxLength={CODE_LEN}
          />
        </h3>


        <button
          onClick={() => onRedeem?.(ncode)}
          disabled={ncode.length !== CODE_LEN || autoing}
          className={`mt-3 w-full py-2 px-4 rounded-md text-white transition
            ${ncode.length === CODE_LEN && !autoing
              ? "bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              : "bg-gray-400 cursor-not-allowed"}`}
          title={ncode.length !== CODE_LEN ? `ใส่ให้ครบ ${CODE_LEN} ตัวก่อน` : "Redeem Now"}
        >
          {autoing ? "Checking…" : "Redeem Now"}
        </button>
      </div>
    </div>
  );
};

export default PromotionCard;
