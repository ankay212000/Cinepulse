'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import ReadOnlyDiagramPreview from '@/components/ReadOnlyDiagramPreview';
import {
  categoryMeta,
  formatRelativeTime,
} from '@/components/CommunityPostDetailModal';
import { useAuth } from '@/components/AuthProvider';
import {
  addPostComment,
  castPostVote,
  deleteCommunityPost,
  deletePostComment,
  fetchProtectedSolutionContent,
  fetchUserVoteForPost,
  getDevSeedPostById,
  getDevSeedPostComments,
  getProblemSolutionAccess,
  listPostComments,
  updateCommunityPost,
} from '@/lib/communityRepo';
import { resolveSolutionMaxScore } from '@/lib/scoringScale';
import type {
  CommunityComment,
  CommunityPostSummary,
  ProtectedSolutionContent,
  VoteDirection,
} from '@/types';
import {
  ArrowBigDown,
  ArrowBigUp,
  ArrowLeft,
  ArrowUpRight,
  Building2,
  Check,
  CheckCircle2,
  Eye,
  Lock,
  MessageSquare,
  Pencil,
  Send,
  Share2,
  Trash2,
} from 'lucide-react';

function renderInlineArticleText(text: string): React.ReactNode[] {
  const tokens = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return tokens.map((tok, idx) => {
    if (tok.startsWith('`') && tok.endsWith('`') && tok.length >= 2) {
      return (
        <code
          key={idx}
          className="px-1.5 py-0.5 rounded bg-subtle border border-hairline font-mono text-[13px] text-ink"
        >
          {tok.slice(1, -1)}
        </code>
      );
    }
    if (tok.startsWith('**') && tok.endsWith('**') && tok.length >= 4) {
      return (
        <strong key={idx} className="font-semibold text-ink">
          {tok.slice(2, -2)}
        </strong>
      );
    }
    return <React.Fragment key={idx}>{tok}</React.Fragment>;
  });
}

function ArticleMarkdownBlock({ markdown }: { markdown: string }) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    if (trimmed.startsWith('```')) {
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i += 1;
      }
      i += 1;
      blocks.push(
        <pre
          key={`code_${i}`}
          className="p-4 rounded bg-canvas border border-hairline font-mono text-xs sm:text-[13px] text-ink overflow-x-auto leading-relaxed"
        >
          {codeLines.join('\n')}
        </pre>
      );
      continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      blocks.push(<hr key={`hr_${i}`} className="border-hairline my-4" />);
      i += 1;
      continue;
    }

    if (trimmed.startsWith('#### ')) {
      blocks.push(
        <h4
          key={`h4_${i}`}
          className="text-sm sm:text-[15px] font-semibold text-ink pt-2 tracking-tight"
        >
          {renderInlineArticleText(trimmed.slice(5))}
        </h4>
      );
      i += 1;
      continue;
    }

    if (trimmed.startsWith('### ')) {
      blocks.push(
        <h3
          key={`h3_${i}`}
          className="text-base sm:text-[17px] font-semibold text-ink pt-3 tracking-tight"
        >
          {renderInlineArticleText(trimmed.slice(4))}
        </h3>
      );
      i += 1;
      continue;
    }

    if (trimmed.startsWith('## ') || trimmed.startsWith('# ')) {
      const content = trimmed.replace(/^#{1,2}\s+/, '');
      blocks.push(
        <h2
          key={`h2_${i}`}
          className="text-lg sm:text-xl font-semibold text-ink pt-3 tracking-tight"
        >
          {renderInlineArticleText(content)}
        </h2>
      );
      i += 1;
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ''));
        i += 1;
      }
      blocks.push(
        <ul
          key={`ul_${i}`}
          className="list-disc pl-5 space-y-1.5 text-sm sm:text-[15px] text-secondary leading-relaxed"
        >
          {items.map((item, idx) => (
            <li key={idx}>{renderInlineArticleText(item)}</li>
          ))}
        </ul>
      );
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
        i += 1;
      }
      blocks.push(
        <ol
          key={`ol_${i}`}
          className="list-decimal pl-5 space-y-1.5 text-sm sm:text-[15px] text-secondary leading-relaxed"
        >
          {items.map((item, idx) => (
            <li key={idx}>{renderInlineArticleText(item)}</li>
          ))}
        </ol>
      );
      continue;
    }

    blocks.push(
      <p
        key={`p_${i}`}
        className="text-sm sm:text-[15px] text-secondary leading-relaxed"
      >
        {renderInlineArticleText(trimmed)}
      </p>
    );
    i += 1;
  }

  return <div className="space-y-3.5">{blocks}</div>;
}

export default function CommunityPostPageView({
  postId,
  initialPost,
  initialComments,
}: {
  postId: string;
  initialPost: CommunityPostSummary | null;
  initialComments: CommunityComment[];
}) {
  const router = useRouter();
  const { user, profile, isDummyUser, signInWithGoogle } = useAuth();

  const [post, setPost] = useState<CommunityPostSummary | null>(initialPost);
  const [comments, setComments] = useState<CommunityComment[]>(initialComments);
  const [loadingComments, setLoadingComments] = useState(false);

  const [userVote, setUserVote] = useState<VoteDirection>(0);
  const [voting, setVoting] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  const [solutionContent, setSolutionContent] =
    useState<ProtectedSolutionContent | null>(null);
  const [loadingSolution, setLoadingSolution] = useState(false);
  const [solutionError, setSolutionError] = useState<string | null>(null);

  const [replyText, setReplyText] = useState('');
  const [submittingReply, setSubmittingReply] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deletingPost, setDeletingPost] = useState(false);

  const [isEditingPost, setIsEditingPost] = useState(false);
  const [editTab, setEditTab] = useState<'edit' | 'preview'>('edit');
  const [editTitle, setEditTitle] = useState(initialPost?.title ?? '');
  const [editCompany, setEditCompany] = useState(
    initialPost?.companyTag ?? ''
  );
  const [editRole, setEditRole] = useState(initialPost?.roleTag ?? '');
  const [editTags, setEditTags] = useState(
    initialPost ? initialPost.tags.join(', ') : ''
  );
  const [editBody, setEditBody] = useState(initialPost?.bodyMarkdown ?? '');
  const [savingEdit, setSavingEdit] = useState(false);

  // Hydrate newly created local dev dummy posts if server had no entry
  useEffect(() => {
    if (post) return;
    if (process.env.NODE_ENV === 'development' && postId.startsWith('dev_')) {
      const localPost = getDevSeedPostById(postId);
      if (localPost) {
        setPost(localPost);
        setComments(getDevSeedPostComments(postId));
      }
    }
  }, [post, postId]);

  const isAuthor = Boolean(user && post && user.uid === post.authorUid);
  const isSolution = Boolean(
    post && post.category === 'solution' && post.problemId
  );

  const solutionAccess =
    isSolution && post?.problemId
      ? getProblemSolutionAccess(profile, post.problemId)
      : {
          unlocked: true,
          canPost: true,
          hasAc: true,
          runsCount: 0,
          requiredAttempts: 3,
        };

  const canReadFullContent =
    !isSolution || Boolean(user && (isAuthor || solutionAccess.unlocked));

  useEffect(() => {
    let cancelled = false;
    if (!user || !post) {
      setUserVote(0);
      return;
    }
    fetchUserVoteForPost(post.postId, user.uid, isDummyUser).then((v) => {
      if (!cancelled) setUserVote(v);
    });
    return () => {
      cancelled = true;
    };
  }, [post, user, isDummyUser]);

  useEffect(() => {
    let cancelled = false;
    if (!post || !isSolution || !canReadFullContent) {
      setSolutionContent(null);
      setLoadingSolution(false);
      return;
    }

    setLoadingSolution(true);
    setSolutionError(null);
    fetchProtectedSolutionContent(post.postId, isDummyUser)
      .then((content) => {
        if (cancelled) return;
        setSolutionContent(content);
      })
      .catch(() => {
        if (!cancelled) {
          setSolutionError(
            'Solution content is locked until you achieve AC or complete 3 official submissions on this problem.'
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingSolution(false);
      });

    setLoadingComments(true);
    listPostComments(post.postId, isDummyUser)
      .then((list) => {
        if (!cancelled) setComments(list);
      })
      .catch(() => {
        if (!cancelled) setComments([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingComments(false);
      });

    return () => {
      cancelled = true;
    };
  }, [post, isSolution, canReadFullContent, isDummyUser]);

  async function handleCopyUrl() {
    const url =
      typeof window !== 'undefined'
        ? `${window.location.origin}/community/${encodeURIComponent(postId)}`
        : `https://hldarena.vercel.app/community/${encodeURIComponent(postId)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    } catch {
      // Ignore clipboard failure
    }
  }

  async function handleVote(dir: 1 | -1) {
    if (!post) return;
    if (!user) {
      void signInWithGoogle();
      return;
    }
    if (voting) return;
    setVoting(true);
    setActionError(null);
    try {
      const res = await castPostVote(post.postId, user, dir, isDummyUser);
      setUserVote(res.userVote);
      setPost({
        ...post,
        upvotes: res.upvotes,
        downvotes: res.downvotes,
        netVotes: res.netVotes,
      });
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Could not update vote.'
      );
    } finally {
      setVoting(false);
    }
  }

  function startEditingPost() {
    if (!post) return;
    setEditTitle(post.title);
    setEditCompany(post.companyTag ?? '');
    setEditRole(post.roleTag ?? '');
    setEditTags(post.tags.join(', '));
    setEditBody(
      isSolution
        ? solutionContent?.bodyMarkdown ?? ''
        : post.bodyMarkdown ?? post.previewExcerpt
    );
    setEditTab('edit');
    setActionError(null);
    setIsEditingPost(true);
  }

  async function handleSavePostEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!post || !isAuthor || savingEdit) return;
    setSavingEdit(true);
    setActionError(null);
    try {
      const parsedTags = editTags
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const { updatedSummary, cleanBody } = await updateCommunityPost(
        post,
        {
          title: editTitle,
          bodyMarkdown: editBody,
          tags: parsedTags,
          companyTag:
            post.category === 'interview_experience' ? editCompany : null,
          roleTag: post.category === 'interview_experience' ? editRole : null,
        },
        isDummyUser
      );
      if (isSolution && solutionContent) {
        setSolutionContent({
          ...solutionContent,
          bodyMarkdown: cleanBody,
        });
      }
      setPost(updatedSummary);
      setIsEditingPost(false);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Could not save changes.'
      );
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDeletePost() {
    if (!post || !isAuthor || deletingPost) return;
    setDeletingPost(true);
    try {
      await deleteCommunityPost(post.postId, post.category, isDummyUser);
      router.push('/community');
    } catch {
      setActionError('Could not delete post.');
      setDeletingPost(false);
    }
  }

  async function handleAddComment(e: React.FormEvent) {
    e.preventDefault();
    if (!post) return;
    if (!user) {
      void signInWithGoogle();
      return;
    }
    if (!replyText.trim() || submittingReply) return;
    setSubmittingReply(true);
    setActionError(null);
    try {
      const created = await addPostComment(
        post.postId,
        user,
        replyText,
        isDummyUser
      );
      setComments((prev) => [...prev, created]);
      setReplyText('');
      setPost({
        ...post,
        commentCount: post.commentCount + 1,
      });
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Failed to post reply.'
      );
    } finally {
      setSubmittingReply(false);
    }
  }

  async function handleDeleteComment(commentId: string) {
    if (!post) return;
    try {
      await deletePostComment(post.postId, commentId, isDummyUser);
      setComments((prev) => prev.filter((c) => c.commentId !== commentId));
      setPost({
        ...post,
        commentCount: Math.max(0, post.commentCount - 1),
      });
    } catch {
      setActionError('Could not delete comment.');
    }
  }

  const cat = post ? categoryMeta(post.category) : null;

  return (
    <div className="min-h-screen flex flex-col bg-app text-ink">
      <SiteHeader activeNav="community" />

      {/*
        Pageless: the post sits directly on the page background and is as wide as
        the site header (same max width and side padding), with no card around it.
      */}
      <main className="flex-1 w-full max-w-[1640px] mx-auto px-4 min-[380px]:px-6 sm:px-10 lg:px-14 py-8 sm:py-10 space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <Link
            href="/community"
            className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider text-muted hover:text-ink transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Community</span>
          </Link>

          {post && (
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                id="copy-community-post-link-btn"
                onClick={() => void handleCopyUrl()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-strong bg-surface hover:bg-subtle text-xs font-medium text-ink cursor-pointer transition-colors"
              >
                {copiedUrl ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Copied Link!</span>
                  </>
                ) : (
                  <>
                    <Share2 className="w-3.5 h-3.5 text-accent" />
                    <span>Share Link</span>
                  </>
                )}
              </button>

              {isAuthor && canReadFullContent && !isEditingPost && (
                <button
                  type="button"
                  onClick={startEditingPost}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-hairline bg-surface hover:bg-subtle text-xs font-medium text-ink cursor-pointer transition-colors"
                >
                  <Pencil className="w-3 h-3" />
                  <span>Edit</span>
                </button>
              )}

              {isAuthor && (
                <button
                  type="button"
                  disabled={deletingPost}
                  onClick={() => void handleDeletePost()}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-hairline bg-surface hover:border-red-500/40 text-xs text-muted hover:text-red-600 dark:hover:text-red-400 cursor-pointer transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>{deletingPost ? 'Deleting...' : 'Delete'}</span>
                </button>
              )}
            </div>
          )}
        </div>

        {!post ? (
          <div className="w-full max-w-4xl mx-auto p-10 rounded border border-hairline bg-surface text-center space-y-3">
            <h1 className="text-lg font-semibold text-ink">
              Community Discussion Not Found
            </h1>
            <p className="text-sm text-secondary max-w-md mx-auto">
              This post may have been removed or the URL is invalid.
            </p>
            <Link
              href="/community"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors"
            >
              <span>Browse Community Posts</span>
            </Link>
          </div>
        ) : (
          <article id="community-post-article" className="space-y-6 break-words">
            {/* Header + Vote Controls */}
            <header className="flex items-start gap-4 border-b border-hairline pb-5">
              <div className="flex flex-col items-center shrink-0 rounded border border-hairline bg-canvas px-2 py-1.5">
                <button
                  type="button"
                  disabled={voting}
                  onClick={() => void handleVote(1)}
                  title={user ? 'Upvote' : 'Sign in to upvote'}
                  className={`p-0.5 rounded cursor-pointer transition-colors ${
                    userVote === 1
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-muted hover:text-ink'
                  }`}
                >
                  <ArrowBigUp className="w-5 h-5" />
                </button>
                <span
                  className={`font-mono text-sm font-semibold tabular-nums leading-tight ${
                    post.netVotes > 0
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : post.netVotes < 0
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-ink'
                  }`}
                >
                  {post.netVotes}
                </span>
                <button
                  type="button"
                  disabled={voting}
                  onClick={() => void handleVote(-1)}
                  title={user ? 'Downvote' : 'Sign in to downvote'}
                  className={`p-0.5 rounded cursor-pointer transition-colors ${
                    userVote === -1
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-muted hover:text-ink'
                  }`}
                >
                  <ArrowBigDown className="w-5 h-5" />
                </button>
              </div>

              <div className="min-w-0 flex-1 space-y-2.5">
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  {cat && (
                    <span
                      className={`px-2 py-0.5 rounded border font-mono text-[11px] font-semibold ${cat.badgeClass}`}
                    >
                      {cat.label}
                    </span>
                  )}

                  {post.companyTag && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-subtle border border-hairline text-ink font-medium">
                      <Building2 className="w-3 h-3 text-muted" />
                      <span>
                        {post.companyTag}
                        {post.roleTag ? ` · ${post.roleTag}` : ''}
                      </span>
                    </span>
                  )}

                  {post.problemId && (
                    <Link
                      href={`/problems/${post.problemId}`}
                      className="inline-flex items-center gap-1 max-w-full px-2 py-0.5 rounded bg-subtle hover:bg-subtle/80 border border-hairline font-mono text-[11px] text-ink transition-colors"
                    >
                      <span className="shrink-0 text-accent font-semibold">
                        {post.problemCode || 'HLD'}
                      </span>
                      <span className="truncate max-w-[240px]">
                        {post.problemTitle || post.problemId}
                      </span>
                      <ArrowUpRight className="w-3 h-3 text-muted shrink-0" />
                    </Link>
                  )}
                </div>

                <h1 className="text-xl sm:text-2xl font-semibold text-ink leading-snug tracking-tight">
                  {post.title}
                </h1>

                <div className="flex items-center gap-2.5 flex-wrap text-xs text-muted">
                  <span className="font-medium text-secondary">
                    {post.authorName}
                  </span>
                  <span>&middot;</span>
                  <time
                    dateTime={new Date(post.createdAtMs).toISOString()}
                    className="font-mono"
                  >
                    {formatRelativeTime(post.createdAtMs)}
                  </time>
                  {post.tags.map((t) => (
                    <span
                      key={t}
                      className="px-1.5 py-0.5 rounded bg-canvas border border-hairline font-mono text-[11px] text-secondary"
                    >
                      #{t}
                    </span>
                  ))}
                </div>
              </div>
            </header>

            {actionError && (
              <div className="px-3.5 py-2.5 rounded bg-red-500/10 border border-red-500/30 text-xs text-red-700 dark:text-red-300">
                {actionError}
              </div>
            )}

            {/* Solution Metrics Strip */}
            {post.solutionMetrics && (
              <div className="p-3.5 rounded border border-emerald-500/30 bg-emerald-500/5 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <div className="text-[11px] text-muted">Judge Verdict</div>
                  <div className="mt-0.5 inline-flex items-center gap-1 font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>
                      AC ({post.solutionMetrics.totalScore}/
                      {resolveSolutionMaxScore(
                        post.solutionMetrics,
                        post.problemCode
                      )}
                      )
                    </span>
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-muted">Simulated p99</div>
                  <div className="mt-0.5 font-mono font-semibold text-ink tabular-nums">
                    {post.solutionMetrics.p99Ms} ms
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-muted">Availability</div>
                  <div className="mt-0.5 font-mono font-semibold text-ink tabular-nums">
                    {post.solutionMetrics.availabilityPct}%
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-muted">Monthly Run-Rate</div>
                  <div className="mt-0.5 font-mono font-semibold text-ink tabular-nums">
                    ${post.solutionMetrics.monthlyCostUsd.toLocaleString()}/mo
                  </div>
                </div>
              </div>
            )}

            {/* Body Content / Edit Form / Anti-Spoiler Solution Gate */}
            {isEditingPost ? (
              <form
                onSubmit={handleSavePostEdit}
                className="p-4 rounded border border-hairline bg-canvas space-y-3.5 text-sm"
              >
                <div className="space-y-1">
                  <label className="block text-xs text-muted">Title</label>
                  <input
                    type="text"
                    required
                    minLength={3}
                    maxLength={160}
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="w-full px-3 py-2 rounded border border-hairline bg-surface text-ink outline-none focus:border-strong"
                  />
                </div>

                {post.category === 'interview_experience' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="block text-xs text-muted">
                        Company (optional)
                      </label>
                      <input
                        type="text"
                        maxLength={60}
                        value={editCompany}
                        onChange={(e) => setEditCompany(e.target.value)}
                        className="w-full px-3 py-2 rounded border border-hairline bg-surface text-ink outline-none focus:border-strong"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-xs text-muted">
                        Role / Level (optional)
                      </label>
                      <input
                        type="text"
                        maxLength={60}
                        value={editRole}
                        onChange={(e) => setEditRole(e.target.value)}
                        className="w-full px-3 py-2 rounded border border-hairline bg-surface text-ink outline-none focus:border-strong"
                      />
                    </div>
                  </div>
                )}

                <div className="space-y-1">
                  <label className="block text-xs text-muted">
                    Tags (comma-separated, up to 6)
                  </label>
                  <input
                    type="text"
                    value={editTags}
                    onChange={(e) => setEditTags(e.target.value)}
                    className="w-full px-3 py-2 rounded border border-hairline bg-surface text-ink outline-none focus:border-strong"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <label className="block text-xs text-muted">
                      Markdown Content
                    </label>
                    <div className="inline-flex items-center rounded border border-hairline bg-surface p-0.5 text-xs">
                      <button
                        type="button"
                        onClick={() => setEditTab('edit')}
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded font-medium cursor-pointer transition-colors ${
                          editTab === 'edit'
                            ? 'bg-ink text-surface'
                            : 'text-secondary hover:text-ink'
                        }`}
                      >
                        <Pencil className="w-3 h-3" />
                        <span>Edit</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditTab('preview')}
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded font-medium cursor-pointer transition-colors ${
                          editTab === 'preview'
                            ? 'bg-ink text-surface'
                            : 'text-secondary hover:text-ink'
                        }`}
                      >
                        <Eye className="w-3 h-3" />
                        <span>Preview</span>
                      </button>
                    </div>
                  </div>

                  {editTab === 'edit' ? (
                    <textarea
                      required
                      minLength={10}
                      maxLength={30000}
                      rows={12}
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                      className="w-full p-3 rounded border border-hairline bg-surface text-ink font-mono text-xs sm:text-sm leading-relaxed outline-none focus:border-strong resize-y"
                    />
                  ) : (
                    <div className="min-h-[200px] p-4 rounded border border-hairline bg-surface">
                      {editBody.trim() ? (
                        <ArticleMarkdownBlock markdown={editBody} />
                      ) : (
                        <p className="text-xs text-muted italic">
                          Nothing to preview yet.
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <div className="pt-2 border-t border-hairline flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setIsEditingPost(false)}
                    className="px-3.5 py-1.5 rounded border border-hairline bg-subtle/60 hover:bg-subtle text-secondary hover:text-ink text-xs font-medium cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingEdit}
                    className="px-4 py-1.5 rounded bg-ink text-surface hover:opacity-90 disabled:opacity-45 text-xs font-medium cursor-pointer"
                  >
                    {savingEdit ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </form>
            ) : !canReadFullContent ? (
              <div
                id="solution-anti-spoiler-lock"
                className="p-8 rounded border border-hairline bg-canvas flex flex-col items-center text-center gap-3.5"
              >
                <div className="w-11 h-11 rounded-full bg-subtle border border-hairline flex items-center justify-center text-muted">
                  <Lock className="w-4 h-4" />
                </div>

                {!user ? (
                  <>
                    <div className="space-y-1.5 max-w-md">
                      <h2 className="text-base font-semibold text-ink">
                        Sign in to check Solution Access
                      </h2>
                      <p className="text-sm text-secondary leading-relaxed">
                        To keep the problemset fair, question solutions unlock once you achieve{' '}
                        <strong className="text-ink">Accepted (AC)</strong> or complete{' '}
                        <strong className="text-ink">3 official submissions</strong> on that question.
                      </p>
                    </div>
                    <div className="flex items-center gap-3 flex-wrap justify-center pt-1">
                      <button
                        type="button"
                        onClick={() => void signInWithGoogle()}
                        className="px-4 py-2 rounded bg-ink text-surface hover:opacity-90 text-xs sm:text-sm font-medium cursor-pointer"
                      >
                        Sign in with Google
                      </button>
                      {post.problemId && (
                        <Link
                          href={`/problems/${post.problemId}`}
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded border border-strong hover:border-ink text-xs sm:text-sm font-medium text-ink"
                        >
                          <span>Try {post.problemCode || 'Question'} Free</span>
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        </Link>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="space-y-1.5 max-w-md">
                      <h2 className="text-base font-semibold text-ink">
                        Solution Locked ({solutionAccess.runsCount} /{' '}
                        {solutionAccess.requiredAttempts} Attempts)
                      </h2>
                      <p className="text-sm text-secondary leading-relaxed">
                        Achieve <strong className="text-ink">Accepted (AC)</strong> or make{' '}
                        <strong className="text-ink">
                          {Math.max(
                            1,
                            solutionAccess.requiredAttempts -
                              solutionAccess.runsCount
                          )}{' '}
                          more official submission
                          {solutionAccess.requiredAttempts -
                            solutionAccess.runsCount ===
                          1
                            ? ''
                            : 's'}
                        </strong>{' '}
                        on {post.problemCode || 'this question'} to unlock the architecture diagram and writeup.
                      </p>
                    </div>

                    {post.problemId && (
                      <Link
                        href={`/problems/${post.problemId}`}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded bg-accent hover:bg-accent-hover text-white text-xs sm:text-sm font-medium"
                      >
                        <span>Attempt {post.problemCode || 'Question'}</span>
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      </Link>
                    )}
                  </>
                )}
              </div>
            ) : isSolution ? (
              loadingSolution ? (
                <div className="py-10 text-center text-xs font-mono text-muted">
                  Loading verified architecture &amp; writeup...
                </div>
              ) : solutionError ? (
                <div className="p-4 rounded border border-amber-500/30 bg-amber-500/10 text-xs text-amber-800 dark:text-amber-300">
                  {solutionError}
                </div>
              ) : solutionContent ? (
                <div className="space-y-5">
                  <ReadOnlyDiagramPreview
                    snapshot={solutionContent.solutionSnapshot}
                    title={`${post.authorName}'s Verified Architecture`}
                  />
                  <div className="pt-1">
                    <ArticleMarkdownBlock
                      markdown={solutionContent.bodyMarkdown}
                    />
                  </div>
                </div>
              ) : (
                <div className="py-8 text-center text-sm text-muted">
                  Solution details unavailable.
                </div>
              )
            ) : (
              <div className="pt-1">
                <ArticleMarkdownBlock
                  markdown={post.bodyMarkdown ?? post.previewExcerpt}
                />
              </div>
            )}

            {/* Replies Section */}
            {canReadFullContent && (
              <section className="pt-6 border-t border-hairline space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
                    <MessageSquare className="w-4 h-4 text-muted" />
                    <span>Replies ({comments.length})</span>
                  </h2>
                </div>

                {loadingComments ? (
                  <div className="text-xs font-mono text-muted py-2">
                    Loading replies...
                  </div>
                ) : comments.length === 0 ? (
                  <div className="text-sm text-muted py-2">
                    No replies yet. Start the discussion below.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {comments.map((c) => {
                      const canDelete = Boolean(
                        user && user.uid === c.authorUid
                      );
                      return (
                        <div
                          key={c.commentId}
                          className="p-3.5 rounded border border-hairline bg-canvas space-y-1.5"
                        >
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-ink">
                                {c.authorName}
                              </span>
                              <span className="text-muted font-mono">
                                {formatRelativeTime(c.createdAtMs)}
                              </span>
                            </div>
                            {canDelete && (
                              <button
                                type="button"
                                onClick={() =>
                                  void handleDeleteComment(c.commentId)
                                }
                                className="text-muted hover:text-red-600 dark:hover:text-red-400 cursor-pointer"
                                title="Delete comment"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                          <p className="text-sm text-secondary whitespace-pre-wrap leading-relaxed">
                            {c.body}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}

                {user ? (
                  <form onSubmit={handleAddComment} className="flex gap-2.5 pt-1">
                    <input
                      type="text"
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      maxLength={2000}
                      placeholder="Add a technical reply or follow-up question..."
                      className="flex-1 min-w-0 px-3.5 py-2 rounded border border-hairline bg-canvas text-sm text-ink outline-none focus:border-strong"
                    />
                    <button
                      type="submit"
                      disabled={submittingReply || !replyText.trim()}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded bg-ink text-surface hover:opacity-90 disabled:opacity-45 text-sm font-medium cursor-pointer shrink-0"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>{submittingReply ? 'Posting...' : 'Reply'}</span>
                    </button>
                  </form>
                ) : (
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => void signInWithGoogle()}
                      className="text-xs sm:text-sm text-secondary hover:text-ink underline cursor-pointer"
                    >
                      Sign in with Google to reply or vote
                    </button>
                  </div>
                )}
              </section>
            )}
          </article>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
