import { SchoolController } from './school.controller';
import { SchoolService } from './school.service';

/** School: classes, students from admission to graduation, fee types and rates, billing runs, arrears, promotion (registered in app.module.ts). */
export const SCHOOL_CONTROLLERS: any[] = [SchoolController];
export const SCHOOL_PROVIDERS: any[] = [SchoolService];
