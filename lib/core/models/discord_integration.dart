import 'package:equatable/equatable.dart';

class DiscordIntegration extends Equatable {
  final String id;
  final String workspaceId;
  final String guildId;
  final String guildName;
  final String? guildIconUrl;
  final String botToken;
  final List<DiscordChannel> channels;
  final String createdBy;
  final DateTime createdAt;
  final DateTime lastSyncAt;

  const DiscordIntegration({
    required this.id,
    required this.workspaceId,
    required this.guildId,
    required this.guildName,
    this.guildIconUrl,
    required this.botToken,
    required this.channels,
    required this.createdBy,
    required this.createdAt,
    required this.lastSyncAt,
  });

  // Copy with method for immutability
  DiscordIntegration copyWith({
    String? id,
    String? workspaceId,
    String? guildId,
    String? guildName,
    String? guildIconUrl,
    String? botToken,
    List<DiscordChannel>? channels,
    String? createdBy,
    DateTime? createdAt,
    DateTime? lastSyncAt,
  }) {
    return DiscordIntegration(
      id: id ?? this.id,
      workspaceId: workspaceId ?? this.workspaceId,
      guildId: guildId ?? this.guildId,
      guildName: guildName ?? this.guildName,
      guildIconUrl: guildIconUrl ?? this.guildIconUrl,
      botToken: botToken ?? this.botToken,
      channels: channels ?? this.channels,
      createdBy: createdBy ?? this.createdBy,
      createdAt: createdAt ?? this.createdAt,
      lastSyncAt: lastSyncAt ?? this.lastSyncAt,
    );
  }

  // Convert to JSON for storage
  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'workspaceId': workspaceId,
      'guildId': guildId,
      'guildName': guildName,
      'guildIconUrl': guildIconUrl,
      'botToken': botToken,
      'channels': channels.map((channel) => channel.toJson()).toList(),
      'createdBy': createdBy,
      'createdAt': createdAt.toIso8601String(),
      'lastSyncAt': lastSyncAt.toIso8601String(),
    };
  }

  // Create from JSON for storage retrieval
  factory DiscordIntegration.fromJson(Map<String, dynamic> json) {
    return DiscordIntegration(
      id: json['id'],
      workspaceId: json['workspaceId'],
      guildId: json['guildId'],
      guildName: json['guildName'],
      guildIconUrl: json['guildIconUrl'],
      botToken: json['botToken'],
      channels: (json['channels'] as List)
          .map((channelJson) => DiscordChannel.fromJson(channelJson))
          .toList(),
      createdBy: json['createdBy'],
      createdAt: DateTime.parse(json['createdAt']),
      lastSyncAt: DateTime.parse(json['lastSyncAt']),
    );
  }

  @override
  List<Object?> get props => [
        id,
        workspaceId,
        guildId,
        guildName,
        guildIconUrl,
        botToken,
        channels,
        createdBy,
        createdAt,
        lastSyncAt,
      ];
}

class DiscordChannel extends Equatable {
  final String id;
  final String name;
  final String type; // 'text', 'voice', 'category', etc.
  final bool isSelected;
  final int messageCount;
  final DateTime? lastMessageAt;
  final String? parentId; // Category ID for channels that belong to a category

  const DiscordChannel({
    required this.id,
    required this.name,
    required this.type,
    this.isSelected = false,
    this.messageCount = 0,
    this.lastMessageAt,
    this.parentId,
  });

  // Copy with method for immutability
  DiscordChannel copyWith({
    String? id,
    String? name,
    String? type,
    bool? isSelected,
    int? messageCount,
    DateTime? lastMessageAt,
    String? parentId,
  }) {
    return DiscordChannel(
      id: id ?? this.id,
      name: name ?? this.name,
      type: type ?? this.type,
      isSelected: isSelected ?? this.isSelected,
      messageCount: messageCount ?? this.messageCount,
      lastMessageAt: lastMessageAt ?? this.lastMessageAt,
      parentId: parentId ?? this.parentId,
    );
  }

  // Convert to JSON for storage
  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'name': name,
      'type': type,
      'isSelected': isSelected,
      'messageCount': messageCount,
      'lastMessageAt': lastMessageAt?.toIso8601String(),
      'parentId': parentId,
    };
  }

  // Create from JSON for storage retrieval
  factory DiscordChannel.fromJson(Map<String, dynamic> json) {
    return DiscordChannel(
      id: json['id'],
      name: json['name'],
      type: json['type'],
      isSelected: json['isSelected'] ?? false,
      messageCount: json['messageCount'] ?? 0,
      lastMessageAt: json['lastMessageAt'] != null
          ? DateTime.parse(json['lastMessageAt'])
          : null,
      parentId: json['parentId'],
    );
  }

  @override
  List<Object?> get props => [
        id,
        name,
        type,
        isSelected,
        messageCount,
        lastMessageAt,
        parentId,
      ];
}

class DiscordMessage extends Equatable {
  final String id;
  final String channelId;
  final String content;
  final DiscordUser author;
  final DateTime timestamp;
  final List<DiscordAttachment>? attachments;
  final List<DiscordEmbed>? embeds;
  final List<DiscordReaction>? reactions;
  final String? referencedMessageId; // For replies

  const DiscordMessage({
    required this.id,
    required this.channelId,
    required this.content,
    required this.author,
    required this.timestamp,
    this.attachments,
    this.embeds,
    this.reactions,
    this.referencedMessageId,
  });

  // Convert to JSON for storage
  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'channelId': channelId,
      'content': content,
      'author': author.toJson(),
      'timestamp': timestamp.toIso8601String(),
      'attachments': attachments?.map((a) => a.toJson()).toList(),
      'embeds': embeds?.map((e) => e.toJson()).toList(),
      'reactions': reactions?.map((r) => r.toJson()).toList(),
      'referencedMessageId': referencedMessageId,
    };
  }

  // Create from JSON for storage or Discord API response
  factory DiscordMessage.fromJson(Map<String, dynamic> json) {
    return DiscordMessage(
      id: json['id'],
      channelId: json['channel_id'] ?? json['channelId'],
      content: json['content'],
      author: DiscordUser.fromJson(json['author']),
      timestamp: DateTime.parse(json['timestamp']),
      attachments: json['attachments'] != null
          ? (json['attachments'] as List)
              .map((a) => DiscordAttachment.fromJson(a))
              .toList()
          : null,
      embeds: json['embeds'] != null
          ? (json['embeds'] as List).map((e) => DiscordEmbed.fromJson(e)).toList()
          : null,
      reactions: json['reactions'] != null
          ? (json['reactions'] as List)
              .map((r) => DiscordReaction.fromJson(r))
              .toList()
          : null,
      referencedMessageId: json['referenced_message']?['id'] ?? 
                          json['referencedMessageId'],
    );
  }

  @override
  List<Object?> get props => [
        id,
        channelId,
        content,
        author,
        timestamp,
        attachments,
        embeds,
        reactions,
        referencedMessageId,
      ];
}

class DiscordUser extends Equatable {
  final String id;
  final String username;
  final String discriminator;
  final String? avatar;
  final bool bot;

  const DiscordUser({
    required this.id,
    required this.username,
    required this.discriminator,
    this.avatar,
    this.bot = false,
  });

  String get displayName => username;

  String? get avatarUrl => avatar != null
      ? 'https://cdn.discordapp.com/avatars/$id/$avatar.${avatar!.startsWith('a_') ? 'gif' : 'png'}'
      : null;

  // Convert to JSON for storage
  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'username': username,
      'discriminator': discriminator,
      'avatar': avatar,
      'bot': bot,
    };
  }

  // Create from JSON for storage or Discord API response
  factory DiscordUser.fromJson(Map<String, dynamic> json) {
    return DiscordUser(
      id: json['id'],
      username: json['username'],
      discriminator: json['discriminator'],
      avatar: json['avatar'],
      bot: json['bot'] ?? false,
    );
  }

  @override
  List<Object?> get props => [id, username, discriminator, avatar, bot];
}

class DiscordAttachment extends Equatable {
  final String id;
  final String filename;
  final String url;
  final int size;
  final int? width;
  final int? height;
  final String? contentType;

  const DiscordAttachment({
    required this.id,
    required this.filename,
    required this.url,
    required this.size,
    this.width,
    this.height,
    this.contentType,
  });

  bool get isImage => contentType?.startsWith('image/') ?? 
                       filename.endsWith('.jpg') || 
                       filename.endsWith('.jpeg') || 
                       filename.endsWith('.png') ||
                       filename.endsWith('.gif') ||
                       filename.endsWith('.webp');

  // Convert to JSON for storage
  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'filename': filename,
      'url': url,
      'size': size,
      'width': width,
      'height': height,
      'contentType': contentType,
    };
  }

  // Create from JSON for storage or Discord API response
  factory DiscordAttachment.fromJson(Map<String, dynamic> json) {
    return DiscordAttachment(
      id: json['id'],
      filename: json['filename'],
      url: json['url'] ?? json['proxy_url'],
      size: json['size'],
      width: json['width'],
      height: json['height'],
      contentType: json['content_type'],
    );
  }

  @override
  List<Object?> get props => [
        id,
        filename,
        url,
        size,
        width,
        height,
        contentType,
      ];
}

class DiscordEmbed extends Equatable {
  final String? title;
  final String? description;
  final String? url;
  final String? timestamp;
  final int? color;
  final Map<String, dynamic>? author;
  final Map<String, dynamic>? image;
  final Map<String, dynamic>? thumbnail;
  final List<Map<String, dynamic>>? fields;

  const DiscordEmbed({
    this.title,
    this.description,
    this.url,
    this.timestamp,
    this.color,
    this.author,
    this.image,
    this.thumbnail,
    this.fields,
  });

  // Convert to JSON for storage
  Map<String, dynamic> toJson() {
    return {
      'title': title,
      'description': description,
      'url': url,
      'timestamp': timestamp,
      'color': color,
      'author': author,
      'image': image,
      'thumbnail': thumbnail,
      'fields': fields,
    };
  }

  // Create from JSON for storage or Discord API response
  factory DiscordEmbed.fromJson(Map<String, dynamic> json) {
    return DiscordEmbed(
      title: json['title'],
      description: json['description'],
      url: json['url'],
      timestamp: json['timestamp'],
      color: json['color'],
      author: json['author'],
      image: json['image'],
      thumbnail: json['thumbnail'],
      fields: json['fields'] != null
          ? (json['fields'] as List)
              .map((f) => f as Map<String, dynamic>)
              .toList()
          : null,
    );
  }

  @override
  List<Object?> get props => [
        title,
        description,
        url,
        timestamp,
        color,
        author,
        image,
        thumbnail,
        fields,
      ];
}

class DiscordReaction extends Equatable {
  final Map<String, dynamic> emoji;
  final int count;
  final bool byMe;

  const DiscordReaction({
    required this.emoji,
    required this.count,
    this.byMe = false,
  });

  // Convert to JSON for storage
  Map<String, dynamic> toJson() {
    return {
      'emoji': emoji,
      'count': count,
      'byMe': byMe,
    };
  }

  // Create from JSON for storage or Discord API response
  factory DiscordReaction.fromJson(Map<String, dynamic> json) {
    return DiscordReaction(
      emoji: json['emoji'],
      count: json['count'],
      byMe: json['me'] ?? false,
    );
  }

  @override
  List<Object?> get props => [emoji, count, byMe];
}