import { createPrismaClient } from './db'

interface CreateNotificationData {
  userId: string
  type: string
  title: string
  content: string
  relatedId?: string
  relatedType?: string
}

export async function createNotification(
  databaseUrl: string,
  data: CreateNotificationData
) {
  const db = createPrismaClient(databaseUrl)
  try {
    await db.notification.create({
      data: {
        userId: data.userId,
        type: data.type,
        title: data.title,
        content: data.content,
        relatedId: data.relatedId,
        relatedType: data.relatedType,
        isRead: false,
      },
    })
  } finally {
    await db.$disconnect()
  }
}

// Notification helpers for common events
export async function notifyPostLiked(
  databaseUrl: string,
  postAuthorId: string,
  likerName: string,
  postId: string,
  postTitle?: string
) {
  await createNotification(databaseUrl, {
    userId: postAuthorId,
    type: 'like',
    title: '有人赞了你的帖子',
    content: `${likerName} 赞了你的帖子"${postTitle || '无标题'}"`,
    relatedId: postId,
    relatedType: 'post',
  })
}

export async function notifyPostCommented(
  databaseUrl: string,
  postAuthorId: string,
  commenterName: string,
  postId: string,
  commentContent: string,
  postTitle?: string
) {
  const truncatedContent = commentContent.length > 50
    ? commentContent.slice(0, 50) + '...'
    : commentContent

  await createNotification(databaseUrl, {
    userId: postAuthorId,
    type: 'comment',
    title: '有人评论了你的帖子',
    content: `${commenterName} 评论: "${truncatedContent}"`,
    relatedId: postId,
    relatedType: 'post',
  })
}

export async function notifyCommentReplied(
  databaseUrl: string,
  commentAuthorId: string,
  replierName: string,
  postId: string,
  replyContent: string
) {
  const truncatedContent = replyContent.length > 50
    ? replyContent.slice(0, 50) + '...'
    : replyContent

  await createNotification(databaseUrl, {
    userId: commentAuthorId,
    type: 'reply',
    title: '有人回复了你的评论',
    content: `${replierName} 回复: "${truncatedContent}"`,
    relatedId: postId,
    relatedType: 'post',
  })
}

export async function notifyEventApproved(
  databaseUrl: string,
  eventId: string,
  eventTitle: string,
  organizerId: string,
  approverName: string
) {
  await createNotification(databaseUrl, {
    userId: organizerId,
    type: 'eventApproved',
    title: '活动已通过审核',
    content: `你创建的活动"${eventTitle}"已被 ${approverName} 批准`,
    relatedId: eventId,
    relatedType: 'event',
  })
}

export async function notifyEventRejected(
  databaseUrl: string,
  eventId: string,
  eventTitle: string,
  organizerId: string,
  rejecterName: string
) {
  await createNotification(databaseUrl, {
    userId: organizerId,
    type: 'eventRejected',
    title: '活动未通过审核',
    content: `你创建的活动"${eventTitle}"已被 ${rejecterName} 拒绝`,
    relatedId: eventId,
    relatedType: 'event',
  })
}

export async function notifyNewEventRsvp(
  databaseUrl: string,
  organizerId: string,
  attendeeName: string,
  eventId: string,
  eventTitle: string
) {
  await createNotification(databaseUrl, {
    userId: organizerId,
    type: 'rsvp',
    title: '有人报名了你的活动',
    content: `${attendeeName} 报名参加了"${eventTitle}"`,
    relatedId: eventId,
    relatedType: 'event',
  })
}

export async function notifyJoinedPlanet(
  databaseUrl: string,
  inviterId: string,
  inviteeName: string,
  planetId: string,
  planetName: string
) {
  await createNotification(databaseUrl, {
    userId: inviterId,
    type: 'memberJoined',
    title: '有人加入了你的星球',
    content: `${inviteeName} 加入了"${planetName}"`,
    relatedId: planetId,
    relatedType: 'planet',
  })
}

export async function notifyRoleChanged(
  databaseUrl: string,
  targetUserId: string,
  changerName: string,
  planetId: string,
  planetName: string,
  newRole: string
) {
  const roleNames: Record<string, string> = {
    starLord: '星球领主',
    elder: '长老',
    pioneer: '先锋',
    citizen: '居民',
  }

  await createNotification(databaseUrl, {
    userId: targetUserId,
    type: 'roleChanged',
    title: '你的角色已变更',
    content: `${changerName} 将你在"${planetName}"的角色更改为 ${roleNames[newRole] || newRole}`,
    relatedId: planetId,
    relatedType: 'planet',
  })
}

export async function notifyQuestCompleted(
  databaseUrl: string,
  userId: string,
  questTitle: string,
  reward: number,
  planetId: string
) {
  await createNotification(databaseUrl, {
    userId,
    type: 'questCompleted',
    title: '任务完成',
    content: `恭喜完成"${questTitle}"，获得 ${reward} 积分奖励`,
    relatedId: planetId,
    relatedType: 'planet',
  })
}
