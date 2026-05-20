import type {Metadata} from 'next';
import './globals.css';
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: 'Cacsms Trader - Autonomous Forex System',
  description: 'Self-driving forex trading platform with MT5 execution.',
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en" className={cn("dark font-sans antialiased")}>
      <body suppressHydrationWarning className="bg-background text-foreground min-h-screen">
        {children}
      </body>
    </html>
  );
}
