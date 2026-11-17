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
import { CurrentUser, Public } from '../accounts/auth/decorators.js';
import { BlogService } from './blog.service.js';
import type {
  CommentView,
  PostDetailView,
  PostLikeView,
  PostView,
  PublishedPostView,
} from './blog.types.js';
import { CreateCommentDto } from './dto/create-comment.dto.js';
import { CreatePostDto } from './dto/create-post.dto.js';
import { ListPostsQueryDto } from './dto/list-posts-query.dto.js';
import {
  CommentResponseDto,
  PaginatedCommentsResponseDto,
  PaginatedPostResponseDto,
  PaginatedPublishedPostsResponseDto,
  PostDetailResponseDto,
  PostLikeResponseDto,
  PostResponseDto,
} from './dto/post.response.dto.js';
import { UpdateCommentDto } from './dto/update-comment.dto.js';
import { UpdatePostDto } from './dto/update-post.dto.js';

@ApiTags('blog')
@Controller()
export class BlogController {
  constructor(private readonly blogService: BlogService) {}

  @Post('posts')
  @ApiCookieAuth()
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiOperation({ summary: 'BLG-01 Create a post as draft or published' })
  @ApiCreatedResponse({ type: PostResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  create(
    @Body() dto: CreatePostDto,
    @CurrentUser() user: AuthUser,
  ): Promise<PostView> {
    return this.blogService.create(dto, user.id);
  }

  @Public()
  @Get('posts')
  @ApiOperation({
    summary: 'BLG-02 Browse paginated published posts filterable by tag',
  })
  @ApiOkResponse({ type: PaginatedPublishedPostsResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid query parameters' })
  listPublished(
    @Query() query: ListPostsQueryDto,
  ): Promise<Paginated<PublishedPostView>> {
    return this.blogService.listPublished(query);
  }

  @Get('posts/mine')
  @ApiCookieAuth()
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiOperation({ summary: 'BLG-03 List own posts including drafts' })
  @ApiOkResponse({ type: PaginatedPostResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid pagination query' })
  listMine(
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<Paginated<PostView>> {
    return this.blogService.listMine(user.id, query);
  }

  @Public()
  @Get('posts/:id')
  @ApiOperation({
    summary: 'BLG-02 Read a published post page with author',
  })
  @ApiParam({ name: 'id', type: String })
  @ApiOkResponse({ type: PostDetailResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid post ID' })
  @ApiNotFoundResponse({
    description: 'Post not found or not publicly visible',
  })
  getById(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
  ): Promise<PostDetailView> {
    return this.blogService.getById(id.toHexString());
  }

  @Patch('posts/:id')
  @ApiCookieAuth()
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
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

  @Delete('posts/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiCookieAuth()
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
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

  @Public()
  @Get('posts/:id/comments')
  @ApiOperation({
    summary:
      'BLG-05 / GEN-05 List paginated comments on a published post in chronological order',
  })
  @ApiParam({ name: 'id', type: String })
  @ApiOkResponse({ type: PaginatedCommentsResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid post ID or pagination query' })
  @ApiNotFoundResponse({
    description: 'Post not found or not publicly visible',
  })
  listComments(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<CommentView>> {
    return this.blogService.listComments(id.toHexString(), query);
  }

  @Post('posts/:id/comments')
  @ApiCookieAuth()
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiOperation({ summary: 'BLG-05 Add a comment to a published post' })
  @ApiParam({ name: 'id', type: String })
  @ApiCreatedResponse({ type: CommentResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid post ID or comment body' })
  @ApiNotFoundResponse({
    description: 'Post not found or not publicly visible',
  })
  createComment(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: CreateCommentDto,
    @CurrentUser() user: AuthUser,
  ): Promise<CommentView> {
    return this.blogService.createComment(id.toHexString(), dto, user.id);
  }

  @Patch('comments/:id')
  @ApiCookieAuth()
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiOperation({ summary: 'BLG-07 Edit own comment' })
  @ApiParam({ name: 'id', type: String })
  @ApiOkResponse({ type: CommentResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid comment ID or body' })
  @ApiNotFoundResponse({
    description: 'Comment not found or owned by another user',
  })
  updateComment(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: UpdateCommentDto,
    @CurrentUser() user: AuthUser,
  ): Promise<CommentView> {
    return this.blogService.updateComment(id.toHexString(), dto, user.id);
  }

  @Delete('comments/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiCookieAuth()
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiOperation({ summary: 'BLG-07 Delete own comment' })
  @ApiParam({ name: 'id', type: String })
  @ApiNoContentResponse({ description: 'Comment deleted' })
  @ApiBadRequestResponse({ description: 'Invalid comment ID' })
  @ApiNotFoundResponse({
    description: 'Comment not found or owned by another user',
  })
  async removeComment(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    await this.blogService.deleteComment(id.toHexString(), user.id);
  }

  @Post('posts/:id/like')
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth()
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiOperation({ summary: 'BLG-06 Like a published post (idempotent)' })
  @ApiParam({ name: 'id', type: String })
  @ApiOkResponse({ type: PostLikeResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid post ID' })
  @ApiNotFoundResponse({
    description: 'Post not found or not publicly visible',
  })
  likePost(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @CurrentUser() user: AuthUser,
  ): Promise<PostLikeView> {
    return this.blogService.likePost(id.toHexString(), user.id);
  }

  @Delete('posts/:id/like')
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth()
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiOperation({
    summary: 'BLG-06 Remove like from a published post (idempotent)',
  })
  @ApiParam({ name: 'id', type: String })
  @ApiOkResponse({ type: PostLikeResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid post ID' })
  @ApiNotFoundResponse({
    description: 'Post not found or not publicly visible',
  })
  unlikePost(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @CurrentUser() user: AuthUser,
  ): Promise<PostLikeView> {
    return this.blogService.unlikePost(id.toHexString(), user.id);
  }
}
