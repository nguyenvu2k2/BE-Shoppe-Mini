import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Address } from '../../../generated/prisma/client';
import { CreateAddressDto } from '../../common/dto/address/create-address.dto';
import { UpdateAddressDto } from '../../common/dto/address/update-address.dto';
import { PrismaService } from '../../prisma/prisma.service';

const MAX_ADDRESSES_PER_USER = 10;

@Injectable()
export class AddressService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllByUserId(userId: number) {
    const addresses = await this.prisma.address.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });

    return addresses.map((address) => this.toResponse(address));
  }

  async create(userId: number, data: CreateAddressDto) {
    const count = await this.prisma.address.count({ where: { userId } });

    if (count >= MAX_ADDRESSES_PER_USER) {
      throw new BadRequestException(
        `You can only save up to ${MAX_ADDRESSES_PER_USER} addresses`,
      );
    }

    const isDefault = count === 0 || data.isDefault === true;

    const address = await this.prisma.$transaction(async (tx) => {
      if (isDefault && count > 0) {
        await tx.address.updateMany({
          where: { userId, isDefault: true },
          data: { isDefault: false },
        });
      }

      return tx.address.create({
        data: {
          userId,
          fullName: data.fullName,
          phone: data.phone,
          addressLine: data.addressLine,
          ward: data.ward,
          district: data.district,
          province: data.province,
          isDefault,
        },
      });
    });

    return this.toResponse(address);
  }

  async update(userId: number, addressId: number, data: UpdateAddressDto) {
    const existing = await this.findOwnedAddress(userId, addressId);

    if (data.isDefault === false && existing.isDefault) {
      throw new BadRequestException(
        'Cannot unset default. Set another address as default first.',
      );
    }

    const address = await this.prisma.$transaction(async (tx) => {
      if (data.isDefault === true) {
        await tx.address.updateMany({
          where: { userId, isDefault: true, id: { not: addressId } },
          data: { isDefault: false },
        });
      }

      return tx.address.update({
        where: { id: addressId },
        data: {
          ...(data.fullName !== undefined && { fullName: data.fullName }),
          ...(data.phone !== undefined && { phone: data.phone }),
          ...(data.addressLine !== undefined && { addressLine: data.addressLine }),
          ...(data.ward !== undefined && { ward: data.ward }),
          ...(data.district !== undefined && { district: data.district }),
          ...(data.province !== undefined && { province: data.province }),
          ...(data.isDefault !== undefined && { isDefault: data.isDefault }),
        },
      });
    });

    return this.toResponse(address);
  }

  async remove(userId: number, addressId: number) {
    const existing = await this.findOwnedAddress(userId, addressId);

    await this.prisma.$transaction(async (tx) => {
      if (existing.isDefault) {
        const nextDefault = await tx.address.findFirst({
          where: { userId, id: { not: addressId } },
          orderBy: { createdAt: 'asc' },
        });

        if (nextDefault) {
          await tx.address.update({
            where: { id: nextDefault.id },
            data: { isDefault: true },
          });
        }
      }

      await tx.address.delete({
        where: { id: addressId },
      });
    });

    return { message: 'Address deleted successfully' };
  }

  async setAsDefault(userId: number, addressId: number) {
    const existing = await this.findOwnedAddress(userId, addressId);

    if (existing.isDefault) {
      return this.toResponse(existing);
    }

    const address = await this.prisma.$transaction(async (tx) => {
      await tx.address.updateMany({
        where: { userId, isDefault: true, id: { not: addressId } },
        data: { isDefault: false },
      });

      return tx.address.update({
        where: { id: addressId },
        data: { isDefault: true },
      });
    });

    return this.toResponse(address);
  }

  private async findOwnedAddress(userId: number, addressId: number) {
    const address = await this.prisma.address.findFirst({
      where: { id: addressId, userId },
    });

    if (!address) {
      throw new NotFoundException('Address not found');
    }

    return address;
  }

  private toResponse(address: Address) {
    return {
      id: address.id,
      fullName: address.fullName,
      phone: address.phone,
      addressLine: address.addressLine,
      ward: address.ward,
      district: address.district,
      province: address.province,
      isDefault: address.isDefault,
      createdAt: address.createdAt,
      updatedAt: address.updatedAt,
    };
  }
}
