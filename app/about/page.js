// app/about/page.js
"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"

const TEXTS = {
  th: {
    title: "📸 Photobooth",
    subtitle: "ระบบถ่ายภาพอัตโนมัติที่ใช้งานง่าย สนุก และแชร์รูปได้ทันที",
    sections: {
      purpose: {
        h: "🎯 จุดประสงค์",
        p: "Photobooth ถูกสร้างขึ้นเพื่อให้ทุกคนสามารถเก็บความทรงจำในรูปแบบดิจิทัลได้อย่างสะดวก รองรับงานอีเวนต์ งานแต่ง ปาร์ตี้ หรือสตูดิโอขนาดเล็ก",
      },
      features: {
        h: "⚡ คุณสมบัติเด่น",
        items: [
          "ถ่ายรูปอัตโนมัติพร้อมนับถอยหลังก่อนถ่าย",
          "รองรับกล้อง DSLR/Mirrorless",
          "แชร์รูปผ่าน QR Code หรืออีเมล",
          "จัดเก็บไฟล์บน Nextcloud อย่างปลอดภัย",
        ],
      },
      tech: {
        h: "🌐 เทคโนโลยีที่ใช้",
        p: "พัฒนาด้วย Next.js + Node.js เชื่อมต่อ MongoDB และ Nextcloud ส่วน UI ใช้ shadcn/ui เพื่อความทันสมัยและใช้งานง่าย",
      },
      team: {
        h: "👥 ทีมพัฒนา",
        p: "ทีม คนบ้า Club ที่หลงใหลด้านการถ่ายภาพและเทคโนโลยี",
      },
    },
    back: "กลับสู่หน้าหลัก",
    gotoDashboard: "ไปหน้า Dashboard",
    langLabel: "ภาษา",
    langTH: "ไทย",
    langEN: "อังกฤษ",
  },
  en: {
    title: "📸 Photobooth",
    subtitle:
      "An easy, fun, and instant photo booth that lets guests share photos right away.",
    sections: {
      purpose: {
        h: "🎯 Purpose",
        p: "Photobooth is built to capture memories effortlessly. Perfect for events, weddings, parties, or compact studios.",
      },
      features: {
        h: "⚡ Key Features",
        items: [
          "Auto capture with countdown",
          "DSLR/Mirrorless camera support",
          "Share via QR Code or Email",
          "Secure storage on Nextcloud",
        ],
      },
      tech: {
        h: "🌐 Tech Stack",
        p: "Built with Next.js + Node.js, connected to MongoDB and Nextcloud. UI is powered by shadcn/ui for a clean, modern experience.",
      },
      team: {
        h: "👥 Team",
        p: "ทีม คนบ้า Club — passionate about photography and technology.",
      },
    },
    back: "Back to Home",
    gotoDashboard: "Go to Dashboard",
    langLabel: "Language",
    langTH: "Thai",
    langEN: "English",
  },
}

export default function AboutPage() {
  const [lang, setLang] = useState("th")

  useEffect(() => {
    const saved = localStorage.getItem("about_lang") || "th"
    setLang(saved)
  }, [])
  useEffect(() => {
    localStorage.setItem("about_lang", lang)
  }, [lang])

  const t = useMemo(() => TEXTS[lang], [lang])

  return (
    <div className="container mx-auto max-w-3xl py-10">
      <Card className="shadow-lg rounded-2xl">
        <CardHeader className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-3xl font-bold">{t.title}</CardTitle>
              <CardDescription>{t.subtitle}</CardDescription>
            </div>

            {/* Language Switcher */}
            <div className="min-w-[170px]">
              <Select value={lang} onValueChange={(v) => setLang(v)}>
                <SelectTrigger aria-label={t.langLabel}>
                  <SelectValue placeholder={t.langLabel} />
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="th">{t.langTH}</SelectItem>
                  <SelectItem value="en">{t.langEN}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>

        <Separator />

        <CardContent className="space-y-6 pt-6">
          <ScrollArea className="h-[55vh] pr-4">
            <div className="space-y-6">
              <Section
                title={t.sections.purpose.h}
                body={
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {t.sections.purpose.p}
                  </p>
                }
              />
              <Section
                title={t.sections.features.h}
                body={
                  <ul className="list-disc list-inside text-sm text-muted-foreground space-y-2">
                    {t.sections.features.items.map((li, i) => (
                      <li key={i}>{li}</li>
                    ))}
                  </ul>
                }
              />
              <Section
                title={t.sections.tech.h}
                body={
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {t.sections.tech.p}
                  </p>
                }
              />
              <Section
                title={t.sections.team.h}
                body={
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {t.sections.team.p}
                  </p>
                }
              />
            </div>
          </ScrollArea>

          <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
            <Button asChild variant="secondary">
              <Link href="/">{t.back}</Link>
            </Button>
            <Button asChild>
              <Link href="/dashboard">{t.gotoDashboard}</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function Section({ title, body }) {
  return (
    <section>
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="mt-2">{body}</div>
    </section>
  )
}
