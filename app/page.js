import { WarpBackground } from "@/components/ui/shadcn-io/warp-background";
import { GradientText } from "@/components/ui/shadcn-io/gradient-text";
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from "@/components/ui/card";

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
        <CardContent className="flex flex-col gap-2 p-4">
          <CardTitle>Congratulations on Your Promotion!</CardTitle>
          <CardDescription>
            Your hard work and dedication have paid off. We&apos;re thrilled to
            see you take this next step in your career. Keep up the fantastic
            work!
          </CardDescription>
        </CardContent>
      </Card>
    </WarpBackground>
  );
}
