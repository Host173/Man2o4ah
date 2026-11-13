import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { BlogModule } from './blog.module.js';
import { BlogService } from './blog.service.js';
import { Comment } from './schemas/comment.schema.js';
import { Like } from './schemas/like.schema.js';
import { Post } from './schemas/post.schema.js';

describe('BlogService (skeleton)', () => {
  it('Provides and exports BlogService from BlogModule', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [BlogModule],
    })
      .overrideProvider(getModelToken(Post.name))
      .useValue({})
      .overrideProvider(getModelToken(Comment.name))
      .useValue({})
      .overrideProvider(getModelToken(Like.name))
      .useValue({})
      .compile();

    expect(moduleRef.get(BlogService)).toBeInstanceOf(BlogService);
  });
});
