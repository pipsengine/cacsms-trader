import type {Metadata} from 'next';
import './globals.css';
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: 'Cacsms Trader - Autonomous Forex System',
  description: 'Self-driving forex trading platform with MT5 execution.',
  icons: {
    icon: [{ url: '/icon', type: 'image/png' }],
    shortcut: ['/icon'],
  },
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en" className={cn("font-sans antialiased")}>
      <body suppressHydrationWarning className="bg-background text-foreground min-h-screen">
        {children}
      </body>
    </html>
  );
}
