import { ClinicController } from './clinic.controller';
import { ClinicService } from './clinic.service';

/** Clinic: patients, practitioners, visits with the medical record, billing, capitation, fees, SIPNAP (registered in app.module.ts). */
export const CLINIC_CONTROLLERS: any[] = [ClinicController];
export const CLINIC_PROVIDERS: any[] = [ClinicService];
