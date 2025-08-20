import { WarpBackground } from "@/components/ui/shadcn-io/warp-background";
import { GradientText } from "@/components/ui/shadcn-io/gradient-text";
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const WARP_CONFIG = {
  perspective: 150,
  beamsPerSide: 4,
  beamSize: 5,
  beamDuration: 1,
};

export default function HomePage() {
  return (
    <WarpBackground
      className="min-h-screen flex justify-center"
      {...WARP_CONFIG}
    >
      <div className="text-center mb-10">
        <GradientText
          className="text-4xl font-bold text-center"
          text="Pcc-Photohub"
          neon
          gradient="linear-gradient(90deg, #00ff00 0%, #00ffff 25%, #ff00ff 50%, #00ffff 75%, #00ff00 100%)"
        />
      </div>
      <Card className="w-80">
        <CardContent className="flex flex-col gap-1 py-4">
          <CardTitle>Welcome to Pcc-Photohub</CardTitle>
          <CardDescription>
            Capture your precious moments with our high-quality photobooth
            service! Perfect for events, parties, and special occasions. Get
            instant prints with fun props and filters.
            <br />
            <br />
          </CardDescription>
          <span className="text-lg text-center font-semibold text-green-600">
            only ฿50 per session
          </span>
          <br />
          <Button>test</Button>
        </CardContent>
      </Card>
    </WarpBackground>
  );
}
