import 'package:flutter/material.dart';

/// A wrapper widget that makes text selectable throughout the app.
/// Use this instead of Text for any text that should be selectable.
class SelectableTextWrapper extends StatelessWidget {
  final String text;
  final TextStyle? style;
  final TextAlign? textAlign;
  final TextOverflow? overflow;
  final int? maxLines;
  final TextWidthBasis? textWidthBasis;
  final bool? softWrap;

  const SelectableTextWrapper(
    this.text, {
    Key? key,
    this.style,
    this.textAlign,
    this.overflow,
    this.maxLines,
    this.textWidthBasis,
    this.softWrap,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return SelectableText(
      text,
      style: style,
      textAlign: textAlign,
      maxLines: maxLines,
      textWidthBasis: textWidthBasis,
      // We need to set this false to match Text widget behavior
      enableInteractiveSelection: true,
    );
  }
}

/// Extension to add selectableVariant method to Text widget
extension SelectableTextExtension on Text {
  /// Creates a SelectableText variant of this Text widget
  SelectableText toSelectable() {
    return SelectableText(
      data ?? '',
      style: style,
      textAlign: textAlign,
      textDirection: textDirection,
      maxLines: maxLines,
      textWidthBasis: textWidthBasis,
      textHeightBehavior: textHeightBehavior,
      strutStyle: strutStyle,
    );
  }
}