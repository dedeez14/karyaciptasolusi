import {
  Award, BadgeCheck, BarChart3, Bell, Briefcase, Building2, Calculator, Calendar, CircleCheck, Clock,
  Cloud, Code, Code2, Cpu, Database, Eye, FileCode2, FileText, Gauge, Globe, GraduationCap, Handshake,
  HardDrive, Headphones, HeartHandshake, Landmark, Laptop, Layers, LayoutDashboard, Lightbulb, Lock,
  Mail, MapPin, Megaphone, MessageCircle, MessageSquare, MessagesSquare, Monitor, Network, Package,
  Palette, PenTool, Phone, Receipt, Rocket, Search, Server, Settings, Shield, ShieldCheck, ShoppingCart,
  Smartphone, Sparkles, Star, Store, Target, TrendingUp, Truck, UserCheck, Users, Wallet, Workflow,
  Wrench, Zap,
  type LucideIcon,
} from 'lucide-react';

/**
 * Ikon yang boleh dipilih dari ERP (nama lucide dalam kebab-case).
 * Sengaja daftar eksplisit — jangan impor seluruh lucide (bundle jadi besar).
 */
export const ICONS: Record<string, LucideIcon> = {
  award: Award,
  'badge-check': BadgeCheck,
  'bar-chart': BarChart3,
  'bar-chart-3': BarChart3,
  bell: Bell,
  briefcase: Briefcase,
  'building-2': Building2,
  building: Building2,
  calculator: Calculator,
  calendar: Calendar,
  'check-circle': CircleCheck,
  'circle-check': CircleCheck,
  clock: Clock,
  cloud: Cloud,
  code: Code,
  'code-2': Code2,
  cpu: Cpu,
  database: Database,
  eye: Eye,
  'file-code-2': FileCode2,
  'file-text': FileText,
  gauge: Gauge,
  globe: Globe,
  'graduation-cap': GraduationCap,
  handshake: Handshake,
  'hard-drive': HardDrive,
  headphones: Headphones,
  'heart-handshake': HeartHandshake,
  landmark: Landmark,
  laptop: Laptop,
  layers: Layers,
  'layout-dashboard': LayoutDashboard,
  lightbulb: Lightbulb,
  lock: Lock,
  mail: Mail,
  'map-pin': MapPin,
  megaphone: Megaphone,
  'message-circle': MessageCircle,
  'message-square': MessageSquare,
  'messages-square': MessagesSquare,
  monitor: Monitor,
  network: Network,
  package: Package,
  palette: Palette,
  'pen-tool': PenTool,
  phone: Phone,
  receipt: Receipt,
  rocket: Rocket,
  search: Search,
  server: Server,
  settings: Settings,
  shield: Shield,
  'shield-check': ShieldCheck,
  'shopping-cart': ShoppingCart,
  smartphone: Smartphone,
  sparkles: Sparkles,
  star: Star,
  store: Store,
  target: Target,
  'trending-up': TrendingUp,
  truck: Truck,
  'user-check': UserCheck,
  users: Users,
  wallet: Wallet,
  workflow: Workflow,
  wrench: Wrench,
  zap: Zap,
};

/** "ShieldCheck" / "shield_check" / " Code2 " → "shield-check" / "code-2" */
function normalize(name: string): string {
  return name
    .trim()
    .replace(/([a-z])([A-Z0-9])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
}

/** Komponen ikon untuk nama dari ERP; nama kosong/tak dikenal → `fallback`. */
export function iconFor(name: string | null | undefined, fallback: LucideIcon = Sparkles): LucideIcon {
  if (!name) return fallback;
  return ICONS[normalize(name)] ?? ICONS[name.trim().toLowerCase()] ?? fallback;
}
