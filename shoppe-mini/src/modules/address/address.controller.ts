import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getUserIdFromCookie } from '../../common/auth/get-user-id-from-cookie';
import type { RequestWithCookies } from '../../common/auth/request-with-cookies.type';
import { CreateAddressDto } from '../../common/dto/address/create-address.dto';
import { UpdateAddressDto } from '../../common/dto/address/update-address.dto';
import { AddressService } from './address.service';

@Controller('users/me/addresses')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
export class AddressController {
  constructor(
    private readonly addressService: AddressService,
    private readonly jwtService: JwtService,
  ) {}

  @Get()
  list(@Req() req: RequestWithCookies) {
    const userId = getUserIdFromCookie(req, this.jwtService);
    return this.addressService.findAllByUserId(userId);
  }

  @Post()
  create(@Req() req: RequestWithCookies, @Body() dto: CreateAddressDto) {
    const userId = getUserIdFromCookie(req, this.jwtService);
    return this.addressService.create(userId, dto);
  }

  @Patch(':id/default')
  setDefault(
    @Req() req: RequestWithCookies,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const userId = getUserIdFromCookie(req, this.jwtService);
    return this.addressService.setAsDefault(userId, id);
  }

  @Patch(':id')
  update(
    @Req() req: RequestWithCookies,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAddressDto,
  ) {
    const userId = getUserIdFromCookie(req, this.jwtService);
    return this.addressService.update(userId, id, dto);
  }

  @Delete(':id')
  remove(
    @Req() req: RequestWithCookies,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const userId = getUserIdFromCookie(req, this.jwtService);
    return this.addressService.remove(userId, id);
  }
}
