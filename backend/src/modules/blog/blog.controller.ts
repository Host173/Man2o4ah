import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ParseObjectIdPipe } from '@nestjs/mongoose';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Types } from 'mongoose';
import type { Paginated } from '../../common/pagination/paginated.js';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';
import type { AuthUser } from '../accounts/auth/auth.types.js';
import { CurrentUser } from '../accounts/auth/decorators.js';
import { BlogService } from './blog.service.js';
import type { PostView } from './blog.types.js';
import { CreatePostDto } from './dto/create-post.dto.js';
import {
  PaginatedPostResponseDto,
  PostResponseDto,
} from './dto/post.response.dto.js';
import { UpdatePostDto } from './dto/update-post.dto.js';

@ApiTags('blog')
@ApiCookieAuth()
@ApiUnauthorizedResponse({ description: 'Authentication required' })
@Controller('posts')
export class BlogController {
  constructor(private readonly blogService: BlogService) {}

  @Post()
  @ApiOperation({ summary: 'BLG-01 Create a post as draft or published' })
  @ApiCreatedResponse({ type: PostResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  create(
    @Body() dto: CreatePostDto,
    @CurrentUser() user: AuthUser,
  ): Promise<PostView> {
    return this.blogService.create(dto, user.id);
  }

  @Get('mine')
  @ApiOperation({ summary: 'BLG-03 List own posts including drafts' })
  @ApiOkResponse({ type: PaginatedPostResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid pagination query' })
  listMine(
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<Paginated<PostView>> {
    return this.blogService.listMine(user.id, query);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'BLG-04 Edit own post' })
  @ApiParam({ name: 'id', type: String })
  @ApiOkResponse({ type: PostResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid post ID or body' })
  @ApiNotFoundResponse({
    description: 'Post not found or owned by another user',
  })
  update(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: UpdatePostDto,
    @CurrentUser() user: AuthUser,
  ): Promise<PostView> {
    return this.blogService.update(id.toHexString(), dto, user.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'BLG-04 Delete own post' })
  @ApiParam({ name: 'id', type: String })
  @ApiNoContentResponse({ description: 'Post deleted' })
  @ApiBadRequestResponse({ description: 'Invalid post ID' })
  @ApiNotFoundResponse({
    description: 'Post not found or owned by another user',
  })
  async remove(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    await this.blogService.delete(id.toHexString(), user.id);
  }
}
