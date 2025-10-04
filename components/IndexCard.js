import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Camera, Sparkles, Users, Printer } from "lucide-react";

const IndexCard = ({ onStartClick }) => {
  return (    
    <Card className="relative w-full max-w-3xl mx-auto mt-6 overflow-visible border border-gray-300/60 bg-white/90 backdrop-blur">
      {/* ===== PRICE TAG : Stacked tilted rectangles, fixed at top-right ===== */}
      <div className="pointer-events-auto absolute -top-5 right-4 sm:-top-6 sm:right-6 z-20">
        <div className="relative inline-block [animation:tagFloat_3s_ease-in-out_infinite]">
          {/* back layer */}
          <div className="absolute inset-0 rotate-6 rounded-md bg-gradient-to-br from-fuchsia-400/70 to-cyan-400/70 blur-[2px]" />
          {/* middle shadow/glow */}
          <div className="absolute -inset-1 rotate-[-4deg] rounded-md bg-black/5 shadow-xl" />
          {/* front card */}
          <div className="relative rotate-[-6deg] rounded-md border border-white/60 bg-white/95 shadow-[0_8px_24px_rgba(16,24,40,0.08)] px-4 py-2">
            <div className="text-[10px] font-semibold tracking-wider text-gray-600">
              SPECIAL PRICE
            </div>
            <div className="mt-0.5 flex items-baseline gap-1">
              <span className="text-xl font-extrabold bg-gradient-to-r from-fuchsia-600 via-indigo-600 to-cyan-600 bg-clip-text text-transparent">
                ฿50
              </span>
              <span className="text-xs text-gray-500">/ session</span>
            </div>

            {/* tag pin / shine */}
            <span className="pointer-events-none absolute -right-1 -top-1 h-8 w-8 rounded-full bg-white/60 blur-md" />
          </div>
        </div>
      </div>

      {/* ===== CONTENT ===== */}
      <CardContent className="flex flex-col gap-6 p-8 sm:p-10">
        {/* Header with Camera Icon (text kept the same) */}
        <div className="text-center space-y-2">
          <div className="mx-auto w-16 h-16 rounded-full flex items-center justify-center bg-gradient-to-br from-blue-500 to-purple-600 shadow-[0_10px_30px_rgba(99,102,241,0.35)]">
            <Camera className="w-8 h-8 text-white" />
          </div>
          <CardTitle className="text-2xl font-extrabold tracking-tight text-gray-800">
            Welcome to Pcc-Photohub
          </CardTitle>
        </div>

        {/* 4 features (text kept the same) */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:text-[15px]">
          <div className="flex items-center gap-2 text-gray-700">
            <Sparkles className="w-4 h-4 text-purple-500" />
            <span>Fun Props & Filters</span>
          </div>
          <div className="flex items-center gap-2 text-gray-700">
            <Users className="w-4 h-4 text-blue-500" />
            <span>Perfect for Events</span>
          </div>
          <div className="flex items-center gap-2 text-gray-700">
            <Printer className="w-4 h-4 text-green-500" />
            <span>Instant Prints</span>
          </div>
          <div className="flex items-center gap-2 text-gray-700">
            <Camera className="w-4 h-4 text-orange-500" />
            <span>High Quality</span>
          </div>
        </div>

        {/* Description (text kept the same) */}
        <CardDescription className="text-center text-gray-600 leading-relaxed">
          Capture your precious moments with our professional photobooth
          service. Having fun with friend, family on this special occasions!
        </CardDescription>

        {/* Start Button – vivid but minimal, not overlapped by price tag */}
        <div className="flex justify-center pt-2">
          <div className="relative group">
            {/* soft outer glow */}
            <div className="absolute -inset-1 rounded-2xl bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500 opacity-60 blur-xl group-hover:opacity-90 transition-opacity duration-500" />
            <Button
              onClick={onStartClick}
              className="relative h-16 sm:h-20 text-2xl sm:text-3xl font-semibold w-72 sm:w-80 rounded-2xl bg-white text-gray-900 border border-gray-200
                         hover:shadow-2xl shadow-lg transition-all duration-300 flex items-center justify-center gap-3 overflow-hidden"
            >
              {/* thin gradient top bar */}
              <span className="pointer-events-none absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-indigo-500 via-fuchsia-500 to-cyan-500 opacity-70" />
              {/* shimmer on hover */}
              <span className="pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,transparent,rgba(255,255,255,0.65),transparent)] translate-x-[-120%] group-hover:translate-x-[120%] transition-transform duration-700 ease-out" />
              {/* subtle inner gradient for text */}
              <Camera className="w-7 h-7 sm:w-8 sm:h-8" />
              <span className="bg-gradient-to-r from-indigo-600 to-fuchsia-600 bg-clip-text text-transparent">
                Start Capturing
              </span>
            </Button>
          </div>
        </div>
      </CardContent>

      {/* ===== keyframes for tag float (inline to avoid editing globals.css) ===== */}
      <style jsx>{`
        @keyframes tagFloat {
          0% { transform: translateY(0px) rotate(1deg); }
          50% { transform: translateY(-2px) rotate(-1deg); }
          100% { transform: translateY(0) rotate(1deg); }
        }
      `}</style>
    </Card>
  );
};

export default IndexCard;
