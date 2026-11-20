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
  UploadedFile,
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
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Types } from 'mongoose';
import type { Paginated } from '../../common/pagination/paginated.js';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';
import type { AuthUser } from '../accounts/auth/auth.types.js';
import { CurrentUser, Public } from '../accounts/auth/decorators.js';
import type { UploadedImage } from '../storage/image-rules.js';
import { ImageUpload } from '../storage/image-upload.decorator.js';
import { BlogService } from './blog.service.js';
import type {
  AuthorPageView,
  CommentView,
  PostDetailView,
  PostLikeView,
  PostView,
  PublishedPostView,
} from './blog.types.js';
import { AuthorPageQueryDto } from './dto/author-page-query.dto.js';
import { CreateCommentDto } from './dto/create-comment.dto.js';
import { CreatePostDto } from './dto/create-post.dto.js';
import { ListPostsQueryDto } from './dto/list-posts-query.dto.js';
import {
  AuthorPageResponseDto,
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
  @ApiOperation({
    summary: 'BLG-01 / BLG-08 Create a post as draft or published',
  })
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
    summary: 'BLG-02 / BLG-09 Browse or search paginated published posts',
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
    summary: 'BLG-02 / GEN-10 Read a published post page with author',
  })
  @ApiParam({ name: 'id', type: String })
  @ApiOkResponse({ type: PostDetailResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid post ID' })
  @ApiNotFoundResponse({
    description: 'Post not found or not publicly visible',
  })
  getById(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @CurrentUser() user?: AuthUser,
  ): Promise<PostDetailView> {
    return this.blogService.getById(id.toHexString(), user);
  }

  @Patch('posts/:id')
  @ApiCookieAuth()
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiOperation({ summary: 'BLG-04 / BLG-08 Edit own post' })
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
      'BLG-05 / GEN-05 / GEN-10 List paginated comments on a published post in chronological order',
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
    @CurrentUser() user?: AuthUser,
  ): Promise<Paginated<CommentView>> {
    return this.blogService.listComments(id.toHexString(), query, user);
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

  @Post('posts/:id/images')
  @ImageUpload()
  @ApiCookieAuth()
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiOperation({ summary: 'BLG-10 Attach an image to own post (GEN-08)' })
  @ApiParam({ name: 'id', type: String })
  @ApiCreatedResponse({ type: PostResponseDto })
  @ApiBadRequestResponse({
    description:
      'Missing image, invalid post ID, invalid image file, or LIMIT_EXCEEDED: post already has 5 images',
  })
  @ApiPayloadTooLargeResponse({ description: 'Image exceeds 5 MB' })
  @ApiNotFoundResponse({
    description: 'Post not found or owned by another user',
  })
  addImage(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @UploadedFile() file: UploadedImage | undefined,
    @CurrentUser() user: AuthUser,
  ): Promise<PostView> {
    return this.blogService.addImage(id.toHexString(), file, user.id);
  }

  @Delete('posts/:id/images/:imageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiCookieAuth()
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiOperation({ summary: 'BLG-10 Remove an image from own post (GEN-08)' })
  @ApiParam({ name: 'id', type: String })
  @ApiParam({ name: 'imageId', type: String })
  @ApiNoContentResponse({ description: 'Image removed from post' })
  @ApiBadRequestResponse({ description: 'Invalid post ID or image ID' })
  @ApiNotFoundResponse({
    description: 'Post or image not found, or post owned by another user',
  })
  async removeImage(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Param('imageId', ParseObjectIdPipe) imageId: Types.ObjectId,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    await this.blogService.removeImage(
      id.toHexString(),
      imageId.toHexString(),
      user.id,
    );
  }

  @Public()
  @Get('tags/:tag/posts')
  @ApiOperation({
    summary: 'BLG-08 List paginated published posts for a tag',
  })
  @ApiParam({ name: 'tag', type: String })
  @ApiOkResponse({ type: PaginatedPublishedPostsResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid tag or pagination query' })
  listByTag(
    @Param('tag') tag: string,
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<PublishedPostView>> {
    return this.blogService.listByTag(tag, query);
  }

  @Public()
  @Get('authors/:id')
  @ApiOperation({
    summary:
      'BLG-12 Read a public author page with published posts and public itineraries',
  })
  @ApiParam({ name: 'id', type: String })
  @ApiOkResponse({ type: AuthorPageResponseDto })
  @ApiBadRequestResponse({
    description: 'Invalid author ID or pagination query',
  })
  @ApiNotFoundResponse({
    description: 'Author not found, deactivated, or not a user account',
  })
  getAuthorPage(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Query() query: AuthorPageQueryDto,
  ): Promise<AuthorPageView> {
    return this.blogService.getAuthorPage(id.toHexString(), query);
  }
}
