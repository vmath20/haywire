import { HomeHero } from "@/components/HomeHero";
import { ProductExplainer } from "@/components/ProductExplainer";
import { SiteFooter } from "@/components/SiteFooter";

export default function HomePage() {
  return (
    <>
      <HomeHero />
      <ProductExplainer />
      <SiteFooter />
    </>
  );
}
