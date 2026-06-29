import { StyleSheet } from 'react-native';

export const styles = StyleSheet.create({
  screen: {
    flex: 1,
    position: 'relative',
  },
  content: {
    gap: 16,
    padding: 16,
    paddingBottom: 96,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
  },
  heading: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  subheading: {
    fontSize: 16,
    fontWeight: '700',
    marginTop: 12,
  },
  section: {
    gap: 8,
    marginBottom: 16,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  listItem: {
    borderColor: '#cccccc',
    borderWidth: 1,
    gap: 4,
    padding: 10,
  },
  tripListItem: {
    alignItems: 'center',
    borderColor: '#cccccc',
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    padding: 10,
  },
  tripThumbnail: {
    alignItems: 'center',
    borderColor: '#777777',
    borderWidth: 1,
    height: 64,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 64,
  },
  tripThumbnailImage: {
    height: 64,
    width: 64,
  },
  tripThumbnailText: {
    fontSize: 24,
    fontWeight: '700',
  },
  tripThumbnailOverlayText: {
    backgroundColor: '#ffffff',
    borderColor: '#444444',
    borderWidth: 1,
    fontWeight: '700',
    paddingHorizontal: 4,
    position: 'absolute',
  },
  tripText: {
    flex: 1,
    gap: 4,
  },
  button: {
    borderColor: '#444444',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  primaryButton: {
    backgroundColor: '#222222',
    borderColor: '#222222',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  buttonText: {
    fontWeight: '700',
  },
  primaryButtonText: {
    color: '#ffffff',
    fontWeight: '700',
  },
  input: {
    borderColor: '#777777',
    borderWidth: 1,
    minHeight: 40,
    padding: 8,
  },
  textArea: {
    borderColor: '#777777',
    borderWidth: 1,
    minHeight: 100,
    padding: 8,
    textAlignVertical: 'top',
  },
  image: {
    height: 160,
    width: 320,
  },
  imagePlaceholder: {
    alignItems: 'center',
    borderColor: '#777777',
    borderWidth: 1,
    height: 160,
    justifyContent: 'center',
    width: 320,
  },
  tripTitle: {
    fontSize: 24,
    fontWeight: '700',
  },
  messageBox: {
    borderColor: '#777777',
    borderWidth: 1,
    minHeight: 80,
    padding: 10,
  },
  statusSummary: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  statusBox: {
    alignItems: 'center',
    borderColor: '#cccccc',
    borderWidth: 1,
    minWidth: 96,
    padding: 10,
  },
  statusIcon: {
    fontSize: 22,
    fontWeight: '700',
  },
  messageScroller: {
    maxHeight: 120,
  },
  messageCard: {
    borderColor: '#cccccc',
    borderWidth: 1,
    marginRight: 8,
    minHeight: 90,
    padding: 10,
    width: 220,
  },
  avatarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  avatarCard: {
    alignItems: 'center',
    borderColor: '#cccccc',
    borderWidth: 1,
    gap: 4,
    minWidth: 96,
    padding: 10,
  },
  avatarInitials: {
    borderColor: '#444444',
    borderWidth: 1,
    fontWeight: '700',
    padding: 8,
  },
  muted: {
    color: '#555555',
  },
  bold: {
    fontWeight: '700',
  },
  toast: {
    backgroundColor: '#ffffff',
    borderColor: '#444444',
    borderWidth: 1,
    bottom: 16,
    gap: 8,
    left: 16,
    padding: 10,
    position: 'absolute',
    right: 16,
  },
});
