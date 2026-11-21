import { ComplianceController } from './compliance.controller';
import { ComplianceService } from './compliance.service';
import { WasteService } from './waste.service';
import { SiinasService } from './siinas.service';

/** Compliance: certificates and licences, TKDN self-assessment, B3 waste, quarterly SIINas (registered in app.module.ts). */
export const COMPLIANCE_CONTROLLERS: any[] = [ComplianceController];
export const COMPLIANCE_PROVIDERS: any[] = [ComplianceService, WasteService, SiinasService];
