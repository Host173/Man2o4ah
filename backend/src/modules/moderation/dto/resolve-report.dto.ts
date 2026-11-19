import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';

/** Allowed resolution actions for `PATCH /api/admin/reports/:id` (`GEN-10`). */
export const ReportResolutionAction = {
  DISMISS: 'dismiss',
  HIDE: 'hide',
  DELETE: 'delete',
} as const;
export type ReportResolutionAction =
  (typeof ReportResolutionAction)[keyof typeof ReportResolutionAction];

/** Request body for `PATCH /api/admin/reports/:id` (`GEN-10`). */
export class ResolveReportDto {
  @ApiProperty({
    enum: Object.values(ReportResolutionAction),
    example: ReportResolutionAction.HIDE,
    description: 'Resolution action to apply to the report and its target item',
  })
  @IsEnum(ReportResolutionAction)
  action!: ReportResolutionAction;
}
