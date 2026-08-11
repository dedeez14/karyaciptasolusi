import { useState, useEffect, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
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
import WhyUsSection from './sections/WhyUsSection';
import PortfolioSection from './sections/PortfolioSection';
import TechStackSection from './sections/TechStackSection';
import TestimonialsSection from './sections/TestimonialsSection';
import ConsultationSection from './sections/ConsultationSection';
import FAQSection from './sections/FAQSection';
import BlogSection from './sections/BlogSection';
import BusinessInfoSection from './sections/BusinessInfoSection';
import CareerSection from './sections/CareerSection';
import NewsletterSection from './sections/NewsletterSection';
import ContactFormSection from './sections/ContactFormSection';
import ContactSection from './sections/ContactSection';

const Tools = lazy(() => import('./pages/Tools'));
const Blog = lazy(() => import('./pages/Blog'));
const BlogPost = lazy(() => import('./pages/BlogPost'));
const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));

/* Scroll ke atas tiap pindah halaman + dukung link lama berformat hash (#/tools) */
function RouterBehavior() {
  const { pathname, hash } = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (hash.startsWith('#/')) {
      navigate(hash.slice(1), { replace: true });
      return;
    }
    if (!hash) window.scrollTo(0, 0);
  }, [pathname, hash, navigate]);

  return null;
}

function HomePage() {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setLoaded(true), 1200);
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
        <WhyUsSection />
        <PortfolioSection />
        <TechStackSection />
        <TestimonialsSection />
        <ConsultationSection />
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
    <BrowserRouter>
      <AuthProvider>
        <RouterBehavior />
        <Suspense fallback={<div className="min-h-[100dvh] bg-white" />}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/tools" element={<Tools />} />
            <Route path="/blog" element={<Blog />} />
            <Route path="/blog/:slug" element={<BlogPost />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  );
}
