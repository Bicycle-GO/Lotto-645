import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://lotto645-map.hopesound.chatgpt.site'),
  title: '로또 6/45 당첨판매점 지도',
  description:
    '역대 로또 6/45 1·2등 당첨판매점을 회차, 지역, 당첨번호와 함께 지도에서 확인하세요.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
