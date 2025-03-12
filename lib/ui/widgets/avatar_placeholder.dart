import 'package:flutter/material.dart';

import 'package:gaia_space/core/services/avatar_service/avatar_service.dart';

class AvatarPlaceholder extends StatelessWidget {
  final String name;
  final double size;
  final Color? backgroundColor;

  const AvatarPlaceholder({
    super.key,
    required this.name,
    this.size = 40,
    this.backgroundColor,
  });

  @override
  Widget build(BuildContext context) {
    return AvatarService().generatePlaceholderAvatar(
      name,
      size: size,
      backgroundColor: backgroundColor ?? Theme.of(context).primaryColor,
    );
  }
}
