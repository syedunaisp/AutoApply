import type { Metadata } from 'next'
import './globals.css'
import ClientLayout from '@/components/ClientLayout'

export const metadata: Metadata = {
  title: 'AutoApply — Automated Job Applications',
  description: 'Your AI-powered job application engine. Find jobs, tailor resumes, submit applications, and send cold emails — all on autopilot.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#0a0b0f] text-surface-50">
        <ClientLayout>{children}</ClientLayout>
      </body>
    </html>
  )
}
