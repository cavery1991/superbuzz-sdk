import './globals.css';

export const metadata = {
  title: 'ShopGraph — Feed Intelligence',
  description: 'Upload a product feed and see what it will appear for on Google Shopping.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
