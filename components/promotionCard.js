"use client";
import React, { useEffect, useRef, useState } from "react";
import { Input } from "./ui/input";

const CODE_LEN = 8;

const PromotionCard = ({ onRedeem }) => {
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);
  const lastFiredRef = useRef("");

  const normalize = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, CODE_LEN);

  useEffect(() => {
    const n = normalize(code);
    if (n.length !== CODE_LEN || n === lastFiredRef.current) return;
    const t = setTimeout(async () => {
      lastFiredRef.current = n;
      setChecking(true);
      try {
        await onRedeem?.(n);
      } finally {
        setChecking(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [code, onRedeem]);

  const handleKeyDown = async (e) => {
    if (e.key === "Enter") {
      const n = normalize(code);
      if (n.length === CODE_LEN) {
        lastFiredRef.current = n;
        setChecking(true);
        try {
          await onRedeem?.(n);
        } finally {
          setChecking(false);
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
            placeholder="Coupon"
            maxLength={CODE_LEN}
          />
        </h3>

        <button
          onClick={() => onRedeem?.(ncode)}
          disabled={ncode.length !== CODE_LEN || checking}
          className={`mt-3 w-full py-2 px-4 rounded-md text-white transition
            ${ncode.length === CODE_LEN && !checking
              ? "bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              : "bg-gray-400 cursor-not-allowed"}`}
          title={ncode.length !== CODE_LEN ? `ใส่ให้ครบ ${CODE_LEN} ตัวก่อน` : "Redeem Now"}
        >
          {checking ? "Checking…" : "Redeem Now"}
        </button>
      </div>
    </div>
  );
};

export default PromotionCard;
