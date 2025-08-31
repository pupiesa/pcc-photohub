import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Camera, Sparkles, Users, Printer } from "lucide-react";

const StartCard = ({ onStartClick }) => {
  return (
    <Card className="w-160 mt-5 backdrop-blur-sm bg-white/90 border-2 border-gray-400 shadow-2xl relative">
      {/* Price Sale Tag - Top Right */}
      <div className="absolute bottom-22 right-26 z-10">
        <div className="relative">
          {/* Main tag shape */}
          <div className="bg-gradient-to-br from-red-500 to-red-600 text-white px-4 py-2 rounded-lg shadow-lg transform -rotate-10 border-2 border-red-400">
            <div className="text-center">
              <div className="text-xs font-semibold uppercase tracking-wide">
                ONLY
              </div>
              <div className="text-lg font-bold">฿50</div>
            </div>
            {/* Tag hole */}
            <div className="absolute top-1/2 left-1 w-2 h-2 bg-white rounded-full transform -translate-y-1/2 shadow-inner"></div>
          </div>
          {/* Shadow/3D effect */}
          <div className="absolute inset-0 bg-red-700 rounded-lg transform rotate-12 translate-x-1 translate-y-1 -z-10"></div>
        </div>
      </div>

      <CardContent className="flex flex-col gap-6 p-8">
        {/* Header with Camera Icon */}
        <div className="text-center space-y-2">
          <div className="mx-auto w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center mb-4">
            <Camera className="w-8 h-8 text-white" />
          </div>
          <CardTitle className="text-2xl font-bold bg-gradient-to-r from-gray-800 to-gray-600 bg-clip-text text-transparent">
            Welcome to Pcc-Photohub
          </CardTitle>
        </div>

        {/* Features Grid */}
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="flex items-center gap-2 text-gray-600">
            <Sparkles className="w-4 h-4 text-purple-500" />
            <span>Fun Props & Filters</span>
          </div>
          <div className="flex items-center gap-2 text-gray-600">
            <Users className="w-4 h-4 text-blue-500" />
            <span>Perfect for Events</span>
          </div>
          <div className="flex items-center gap-2 text-gray-600">
            <Printer className="w-4 h-4 text-green-500" />
            <span>Instant Prints</span>
          </div>
          <div className="flex items-center gap-2 text-gray-600">
            <Camera className="w-4 h-4 text-orange-500" />
            <span>High Quality</span>
          </div>
        </div>

        {/* Description */}
        <CardDescription className="text-center text-gray-600 leading-relaxed">
          Capture your precious moments with our professional photobooth
          service. Having fun with friend, family on this special occasions!
        </CardDescription>

        {/* Start Button */}
        <div className="flex justify-center pt-4">
          <Button
            onClick={onStartClick}
            className="h-20 text-4xl font-bold w-80 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 rounded-2xl shadow-lg transform transition-all duration-200 hover:scale-105"
          >
            <Camera className="w-8 h-8 mr-3" />
            Start Capturing
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default StartCard;
