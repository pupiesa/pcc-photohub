"use client";
import React from "react";

const PromotionCard = ({ couponCode, details, onRedeem }) => {
  const label =
    details?.type === "percent"
      ? `${details.value}% off`
      : details?.type === "amount"
      ? `฿${details.value} off`
      : null;

  const fmt = (s) => (s ? new Date(s).toLocaleDateString() : "");

  return (
    <div className="p-4 border rounded-md shadow-md bg-white dark:bg-gray-800 w-[320px]">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
        {couponCode} {label ? `– ${label}` : ""}
      </h3>

      {(details?.startAt || details?.endAt) && (
        <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
          Valid {fmt(details?.startAt)}–{fmt(details?.endAt)}
        </p>
      )}

      {typeof details?.usedCount === "number" &&
        typeof details?.usageLimit === "number" && (
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
            Used {details.usedCount}/{details.usageLimit} • per-user{" "}
            {details.perUserLimit ?? 1}
          </p>
        )}

      <button
        onClick={onRedeem}
        className="mt-3 w-full py-2 px-4 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
      >
        Redeem Now
      </button>
    </div>
  );
};

export default PromotionCard;
