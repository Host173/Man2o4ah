import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto.js';
import { ReportStatus } from '../schemas/report.schema.js';

/** Query parameters for `GET /api/admin/reports` (`GEN-10`). */
export class ListReportsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: Object.values(ReportStatus),
    default: ReportStatus.OPEN,
    example: ReportStatus.OPEN,
    description: 'Filter reports by status (defaults to open)',
  })
  @IsOptional()
  @IsEnum(ReportStatus)
  status: ReportStatus = ReportStatus.OPEN;
}
