import { useState, useEffect } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import Preloader from './components/Preloader';
import ScrollProgress from './components/ScrollProgress';
import BackToTop from './components/BackToTop';
import WhatsAppFloat from './components/WhatsAppFloat';
import CookieConsent from './components/CookieConsent';
import HeroSection from './sections/HeroSection';
import StatsSection from './sections/StatsSection';
import ClientMarquee from './sections/ClientMarquee';
import AboutSection from './sections/AboutSection';
import ServicesSection from './sections/ServicesSection';
import PortfolioSection from './sections/PortfolioSection';
import TechStackSection from './sections/TechStackSection';
import TestimonialsSection from './sections/TestimonialsSection';
import PricingSection from './sections/PricingSection';
import ComparisonSection from './sections/ComparisonSection';
import FAQSection from './sections/FAQSection';
import BlogSection from './sections/BlogSection';
import BusinessInfoSection from './sections/BusinessInfoSection';
import CareerSection from './sections/CareerSection';
import NewsletterSection from './sections/NewsletterSection';
import ContactFormSection from './sections/ContactFormSection';
import ContactSection from './sections/ContactSection';
import Tools from './pages/Tools';

function HomePage() {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setLoaded(true), 2500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="min-h-[100dvh] bg-white">
      <Preloader />
      <ScrollProgress />
      <Navbar />
      <main>
        <HeroSection />
        <StatsSection />
        <ClientMarquee />
        <AboutSection />
        <ServicesSection />
        <PortfolioSection />
        <TechStackSection />
        <TestimonialsSection />
        <PricingSection />
        <ComparisonSection />
        <FAQSection />
        <BlogSection />
        <BusinessInfoSection />
        <CareerSection />
        <NewsletterSection />
        <ContactFormSection />
        <ContactSection />
      </main>
      <Footer />
      {loaded && (
        <>
          <BackToTop />
          <WhatsAppFloat />
          <CookieConsent />
        </>
      )}
    </div>
  );
}

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/tools" element={<Tools />} />
      </Routes>
    </HashRouter>
  );
}
