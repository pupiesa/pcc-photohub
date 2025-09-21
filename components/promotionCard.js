"use client";

import React from "react";

const PromotionCard = ({ couponCode, onRedeem }) => {
  return (
    <div className="p-4 border rounded-md shadow-md bg-white dark:bg-gray-800">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
        Redeem Your Coupon
      </h3>
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Use the code below to redeem your promotion:
      </p>
      <div className="mt-2 p-2 bg-gray-100 dark:bg-gray-700 rounded-md text-center">
        <span className="text-xl font-bold text-gray-900 dark:text-gray-100">
          {couponCode}
        </span>
      </div>
      <button
        onClick={onRedeem}
        className="mt-4 w-full py-2 px-4 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
      >
        Redeem Now
      </button>
    </div>
  );
};

export default PromotionCard;
