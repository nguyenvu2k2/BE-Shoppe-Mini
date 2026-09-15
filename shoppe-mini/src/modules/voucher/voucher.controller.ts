import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '../../common/auth/auth.guard';
import { AuthPermissions } from '../../common/auth/auth-permissions.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { PERMISSIONS } from '../../common/auth/permissions';
import { CreateVoucherDto } from '../../common/dto/voucher/create-voucher.dto';
import { ListVouchersQueryDto } from '../../common/dto/voucher/list-vouchers-query.dto';
import { PreviewVoucherDto } from '../../common/dto/voucher/preview-voucher.dto';
import { UpdateVoucherDto } from '../../common/dto/voucher/update-voucher.dto';
import { VoucherService } from './voucher.service';

@Controller('vouchers')
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
)
export class VoucherController {
  constructor(private readonly voucherService: VoucherService) {}

  // ==================== ADMIN ====================
  // "manage" / "preview" before ":id" so Nest does not treat them as ids.

  @Get('manage')
  @AuthPermissions(PERMISSIONS.VOUCHER_READ)
  findManage(@Query() query: ListVouchersQueryDto) {
    return this.voucherService.findManage(query);
  }

  @Get('manage/:id')
  @AuthPermissions(PERMISSIONS.VOUCHER_READ)
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.voucherService.findOne(id);
  }

  @Post()
  @AuthPermissions(PERMISSIONS.VOUCHER_CREATE)
  create(@Body() dto: CreateVoucherDto) {
    return this.voucherService.create(dto);
  }

  @Patch(':id')
  @AuthPermissions(PERMISSIONS.VOUCHER_UPDATE)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateVoucherDto,
  ) {
    return this.voucherService.update(id, dto);
  }

  @Delete(':id')
  @AuthPermissions(PERMISSIONS.VOUCHER_DELETE)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.voucherService.remove(id);
  }

  // ==================== CUSTOMER ====================

  @Get()
  @UseGuards(AuthGuard)
  listActive() {
    return this.voucherService.listActive();
  }

  @Post('preview')
  @UseGuards(AuthGuard)
  preview(
    @CurrentUser('sub') userId: number,
    @Body() dto: PreviewVoucherDto,
  ) {
    return this.voucherService.preview(userId, dto);
  }
}
