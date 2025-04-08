import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

class AvatarService {
  static final AvatarService _instance = AvatarService._internal();
  factory AvatarService() => _instance;
  AvatarService._internal();

  // Cache avatars to avoid fetching them multiple times
  final Map<String, Uint8List> _avatarCache = {};
  
  // Fetch avatar image and convert it to memory image
  Future<ImageProvider> getAvatarImageProvider(String url) async {
    try {
      // Check if we already have this avatar in the cache
      if (_avatarCache.containsKey(url)) {
        return MemoryImage(_avatarCache[url]!);
      }
      
      // Fetch the image
      final response = await http.get(Uri.parse(url));
      
      // If fetching failed, return a placeholder
      if (response.statusCode != 200) {
        return const AssetImage('assets/images/placeholder_avatar.png');
      }
      
      // Cache the image data and return a memory image
      final imageData = response.bodyBytes;
      _avatarCache[url] = imageData;
      return MemoryImage(imageData);
    } catch (e) {
      // In case of any error, return a placeholder
      return const AssetImage('assets/images/placeholder_avatar.png');
    }
  }
  
  // Get a cached avatar if available, or return null
  ImageProvider? getCachedAvatar(String url) {
    if (_avatarCache.containsKey(url)) {
      return MemoryImage(_avatarCache[url]!);
    }
    return null;
  }
  
  // Generate a placeholder avatar image with the first letter of the name
  Widget generatePlaceholderAvatar(String name, {double size = 24.0, Color? backgroundColor}) {
    final letter = name.isNotEmpty ? name.substring(0, 1).toUpperCase() : "?";
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: backgroundColor ?? Colors.blue,
        shape: BoxShape.circle,
      ),
      child: Center(
        child: Text(
          letter,
          style: TextStyle(
            color: Colors.white,
            fontWeight: FontWeight.bold,
            fontSize: size * 0.5,
          ),
        ),
      ),
    );
  }
  
  // A widget that displays an avatar, handling loading and errors
  Widget avatarWidget({
    required String? avatarUrl,
    required String name,
    double size = 24.0,
    Color? backgroundColor,
  }) {
    if (avatarUrl == null || avatarUrl.isEmpty) {
      return generatePlaceholderAvatar(name, size: size, backgroundColor: backgroundColor);
    }
    
    // Check for cached version first
    final cachedAvatar = getCachedAvatar(avatarUrl);
    if (cachedAvatar != null) {
      return CircleAvatar(
        backgroundColor: backgroundColor,
        radius: size / 2,
        backgroundImage: cachedAvatar,
      );
    }
    
    // Otherwise, load with FutureBuilder
    return FutureBuilder<ImageProvider>(
      future: getAvatarImageProvider(avatarUrl),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return SizedBox(
            width: size,
            height: size,
            child: const CircularProgressIndicator(strokeWidth: 2),
          );
        }
        
        if (snapshot.hasError || !snapshot.hasData) {
          return generatePlaceholderAvatar(name, size: size, backgroundColor: backgroundColor);
        }
        
        return CircleAvatar(
          backgroundColor: backgroundColor,
          radius: size / 2,
          backgroundImage: snapshot.data,
        );
      },
    );
  }
}