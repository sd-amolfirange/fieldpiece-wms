import { Module } from "@nestjs/common";
import { PoliciesModule } from "../policies";
import { ProductImagesService } from "./product-images.service";
import { ProductsController } from "./products.controller";
import { ProductsRepository } from "./products.repository";
import { ProductsService } from "./products.service";

@Module({
  imports: [PoliciesModule],
  controllers: [ProductsController],
  providers: [ProductsService, ProductImagesService, ProductsRepository],
  exports: [ProductsService],
})
export class ProductsModule {}
