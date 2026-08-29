/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @arcgis/core нь ESM-ээр тархдаг тул Next-ийн серверт хөрвүүлэлт хэрэгтэй
  transpilePackages: ["@arcgis/core"],
};
export default nextConfig;
